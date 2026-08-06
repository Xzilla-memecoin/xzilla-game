/* ============================================================================
   XZILLA — cross-player leaderboard (Cloudflare Worker + KV)

   Endpoints
     GET  /top          -> { top: [{ name, score, tier, hold }, ...] }   (top 10, public)
     POST /submit       -> { ok, rank, tier, top }   body: { score, stats, wallet?, initData? }
     GET  /pump         -> { ok, priceUsd, change24, mcap, mode, mult, xpMult, label }
     GET  /daily-top    -> { day, top: [...], players }        ?day=YYYY-MM-DD (default today)
     POST /daily-submit -> { ok, rank, top }   body: { score, stats, day, wallet?, initData? }
     GET  /auth/nonce   -> { nonce, message }                  wallet login challenge
     POST /auth/wallet  -> { ok, token, pid }   body: { address, nonce, signature }
     POST /auth/google  -> { ok, token, pid }   body: { credential }
     GET  /auth/me      -> { ok, pid, name, provider }         Authorization: Bearer <token>

   Identity
     Players are keyed by `pid`, not by a login provider. Telegram, wallet and Google
     identities all MAP to a pid (see AUTH_PREFIX), so one human is one leaderboard row
     across every surface and a second login can be linked later. A Telegram player's
     default pid is their raw Telegram id — which is what every pre-existing record was
     already keyed on — so introducing this layer required no data migration.

   Security
     Telegram players authenticate with the WebApp `initData` HMAC (BOT_TOKEN). Web
     players authenticate with an Ed25519 wallet signature or a Google ID token, and
     receive an HMAC-signed session token (SESSION_SECRET) used thereafter.
     Scores remain client-reported, so submissions are bounded by implausible() and
     account creation can be gated by Turnstile — both matter far more now that a
     login no longer requires owning a real Telegram account.

   Storage
     A single KV key holds the sorted board (top MAX_KEEP). Simple + cheap; for very
     high write concurrency migrate to a Durable Object.
   ========================================================================== */

const TOP_KEY   = "lb:v1";
const MAX_KEEP  = 200;
const MAX_SCORE = 15000000; // sanity ceiling — blocks absurd exploit values. Raised to 15M to leave
                            // generous headroom over the legit ceiling after the scoring/rocket updates.
const RATE_MS   = 30000;   // throttle window — applies ONLY to non-improving resubmits (see /submit)

// $XZILLA SPL mint — the token whose balance sets a player's holder tier/multiplier.
// Overridable via env.XZILLA_MINT if the mint ever changes.
const XZILLA_MINT = "2VzDVUgzTHSf9qCPdkYBeMd2sK7m8t9GR2MN5kxRpump";
const B58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;   // base58 Solana address shape

const ADS_KEY = "ads:v1";     // KV key holding the live billboard ad config
const ADS_MAX_BYTES = 24000;  // reject oversized ad payloads (3 ratio groups + image URLs)
const AD_GROUP_KEYS = ["wide", "square", "tall"];   // the 3 aspect-ratio pools

const IMG_PREFIX = "img:";                 // KV key prefix for uploaded ad images
const IMG_MAX_BYTES = 2_000_000;           // 2 MB cap per ad image
const IMG_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

function cors(origin){
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    // Authorization is required for web (wallet/Google) sessions — without it the
    // browser's preflight rejects every authenticated request from the embed.
    "Access-Control-Allow-Headers": "content-type, x-admin-token, authorization",
    "Access-Control-Max-Age": "86400",
  };
}
function json(data, status, origin){
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "content-type": "application/json", "Cache-Control": "no-store", ...cors(origin) },
  });
}

function toHex(buf){ return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join(""); }
async function hmac(keyBytes, msgBytes){
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", key, msgBytes);
}

// Validate Telegram Mini App initData. Returns the parsed `user` object or null.
async function verifyInitData(initData, botToken){
  if(!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if(!hash) return null;
  params.delete("hash");
  const dcs = [...params.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => k + "=" + v).join("\n");
  const enc = new TextEncoder();
  const secret = await hmac(enc.encode("WebAppData"), enc.encode(botToken)); // key=WebAppData, msg=botToken
  const sig = toHex(await hmac(new Uint8Array(secret), enc.encode(dcs)));     // key=secret,     msg=data_check_string
  if(sig !== hash) return null;
  const authDate = parseInt(params.get("auth_date") || "0", 10);
  if(authDate && (Date.now() / 1000 - authDate) > 86400) return null;         // reject stale (>1 day) payloads
  try{
    const user = JSON.parse(params.get("user") || "null");
    return (user && user.id) ? user : null;
  }catch(_){ return null; }
}

/* ===================== holder tiers (server-authoritative) ==================
   The client shows a tier badge from its own balance read, but the LEADERBOARD
   badge must not be spoofable — otherwise every entry claims WHALE and the flex
   is worthless. So /submit re-reads the balance here and stamps the tier itself.
   Mirrors the TIERS table in game.js; keep the two in sync. */
const TIERS = [
  { min: 10e6, m: 2.0, l: "XZILLA"  },
  { min: 9e6,  m: 1.9, l: "KRAKEN"  },
  { min: 8e6,  m: 1.8, l: "WHALE"   },
  { min: 7e6,  m: 1.7, l: "SHARK"   },
  { min: 6e6,  m: 1.6, l: "DOLPHIN" },
  { min: 5e6,  m: 1.5, l: "BULL"    },
  { min: 4e6,  m: 1.4, l: "APE"     },
  { min: 3e6,  m: 1.3, l: "FISH"    },
  { min: 2e6,  m: 1.2, l: "CRAB"    },
  { min: 1e6,  m: 1.1, l: "SHRIMP"  },
];
function tierFor(bal){ for(const t of TIERS){ if(bal >= t.min) return t; } return null; }

/* ------------------------------ player tags ------------------------------
   Google hands us a FIRST NAME, not a unique handle, so two players called "Alex"
   are indistinguishable on the board — and the client can't tell which row is the
   viewer's own. Both need a stable per-player discriminator.

   It must NOT be the pid: for Telegram players the pid IS their Telegram user id,
   and publishing those on a public leaderboard would leak real account ids. So the
   tag is a short one-way hash instead — stable, comparable, and reversible only by
   brute force over a space nobody cares about.

   The salt is a fixed constant, not SESSION_SECRET: rotating the session secret
   signs everyone out, and must not silently renumber the whole leaderboard too. */
const TAG_SALT = "xzilla-tag-v1";
const _tagCache = new Map();
async function shortTag(pid){
  if(_tagCache.has(pid)) return _tagCache.get(pid);
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(TAG_SALT + ":" + pid));
  const tag = toHex(buf).slice(0, 4);
  if(_tagCache.size < 500) _tagCache.set(pid, tag);   // bounded: this is a per-isolate cache
  return tag;
}
// Decorate leaderboard rows with tags for display. Never exposes `id`.
async function withTags(rows){
  return await Promise.all(rows.map(async e => ({
    name: e.name, score: e.score, tier: e.tier || null, hold: e.hold || 0, tag: await shortTag(e.id),
  })));
}

// Raw on-chain $XZILLA balance for an owner. Returns a number, or null when the
// read fails — null means "unknown", which callers must NOT treat as zero.
async function heliusBalance(address, env){
  if(!env.HELIUS_KEY || !B58_RE.test(address)) return null;
  const mint = env.XZILLA_MINT || XZILLA_MINT;
  try{
    const rpcRes = await fetch("https://mainnet.helius-rpc.com/?api-key=" + env.HELIUS_KEY, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "getTokenAccountsByOwner",
        params: [ address, { mint }, { encoding: "jsonParsed" } ],
      }),
    });
    const data = await rpcRes.json();
    if(data.error) return null;
    let balance = 0;
    for(const acc of (data.result && data.result.value) || []){
      const info = acc && acc.account && acc.account.data && acc.account.data.parsed && acc.account.data.parsed.info;
      const amt = info && info.tokenAmount && info.tokenAmount.uiAmount;
      if(typeof amt === "number") balance += amt;
    }
    return balance;
  }catch(_){ return null; }
}

// Balance behind a short KV cache so a burst of submits can't burn the Helius quota.
const HOLD_PREFIX = "hold:";
const HOLD_TTL    = 600;   // seconds a verified balance is trusted before re-reading
async function cachedBalance(address, env){
  const key = HOLD_PREFIX + address;
  const hit = await env.LB.get(key);
  if(hit !== null){ const n = Number(hit); return Number.isFinite(n) ? n : null; }
  const bal = await heliusBalance(address, env);
  if(bal === null) return null;                                   // don't cache failures
  await env.LB.put(key, String(bal), { expirationTtl: HOLD_TTL });
  return bal;
}

/* ========================================================================== *
 *  IDENTITY — one player, many login methods                                  *
 *                                                                             *
 *  Every player is a `pid`. Login providers MAP to a pid rather than being the *
 *  key themselves, so the same human who plays in Telegram and on the web is   *
 *  one row on the leaderboard with one XP balance — and can link a second      *
 *  login later without an un-doable merge.                                     *
 *                                                                             *
 *  A Telegram player's default pid is their raw Telegram id, which is exactly  *
 *  what every existing record is already keyed on. That makes this change a    *
 *  no-op for current players: no bulk rewrite, no lost standing, no downtime.  *
 *  Non-Telegram pids are prefixed so they can never collide with a numeric id. *
 * ========================================================================== */
const AUTH_PREFIX    = "auth:";   // auth:<provider>:<providerId> -> pid  (link table)
const PROFILE_PREFIX = "p:";      // p:<pid> -> { name, providers, created }
const NONCE_PREFIX   = "nonce:";
const NONCE_TTL      = 300;       // seconds a login nonce stays valid
const SESSION_DAYS   = 30;

// Default pid for a provider identity. Telegram keeps its raw id for back-compat.
// Each provider gets its own prefix so ids from different providers can never collide
// in the pid namespace. Existing prefixes are frozen — changing one orphans live accounts.
function defaultPid(provider, id){
  if(provider === "tg") return String(id);
  if(provider === "wallet")  return "w_" + String(id);
  if(provider === "discord") return "d_" + String(id);
  return "g_" + String(id);
}

/* Resolve a provider identity to a pid, creating the link + profile on first sight.
   The link table is authoritative, so a future "link my wallet to my Telegram account"
   feature just repoints the mapping without touching any game data. */
async function resolvePid(env, provider, id, name){
  const linkKey = AUTH_PREFIX + provider + ":" + id;
  let pid = await env.LB.get(linkKey);
  if(!pid){
    pid = defaultPid(provider, id);
    await env.LB.put(linkKey, pid);
  }
  const profKey = PROFILE_PREFIX + pid;
  let prof = null;
  try{ prof = JSON.parse((await env.LB.get(profKey)) || "null"); }catch(_){}
  const before = prof ? JSON.stringify(prof) : "";
  if(!prof){ prof = { name: name || "Player", providers: {}, created: Date.now() }; }
  if(name) prof.name = name;
  prof.providers[provider] = String(id);
  // WRITE ONLY ON CHANGE. identify() runs on every authenticated request — score submits,
  // XP saves, referral checks — so writing unconditionally burned a KV write per request
  // and would have exhausted the free tier's 1,000 writes/day at very modest traffic.
  // In the steady state a player's profile never changes, so this now costs zero writes.
  const after = JSON.stringify(prof);
  if(after !== before) await env.LB.put(profKey, after);
  return { pid, name: prof.name };
}

/* ------------------------------ session tokens ---------------------------
   Verifying a Google JWT or an Ed25519 signature on every score submit would be
   slow and pointless, so login issues a compact HMAC-signed token instead:
     base64url(payload) "." base64url(hmac)
   Signed with SESSION_SECRET, which must be set (`wrangler secret put`). Without
   it, web login is disabled outright rather than silently unauthenticated. */
function b64urlEncode(bytes){
  let s = ""; for(const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(str){
  const s = str.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "=".repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for(let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function issueSession(env, pid, name, provider){
  if(!env.SESSION_SECRET) return null;
  const enc = new TextEncoder();
  const payload = { pid, name, pv: provider, exp: Date.now() + SESSION_DAYS * 86400000 };
  const body = b64urlEncode(enc.encode(JSON.stringify(payload)));
  const sig  = b64urlEncode(new Uint8Array(await hmac(enc.encode(env.SESSION_SECRET), enc.encode(body))));
  return body + "." + sig;
}
async function readSession(env, token){
  if(!env.SESSION_SECRET || !token || token.indexOf(".") < 0) return null;
  const [body, sig] = token.split(".");
  const enc = new TextEncoder();
  const expect = b64urlEncode(new Uint8Array(await hmac(enc.encode(env.SESSION_SECRET), enc.encode(body))));
  // constant-time-ish compare: same length + full scan, no early return on mismatch
  if(sig.length !== expect.length) return null;
  let diff = 0; for(let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expect.charCodeAt(i);
  if(diff !== 0) return null;
  try{
    const p = JSON.parse(new TextDecoder().decode(b64urlDecode(body)));
    if(!p || !p.pid || !p.exp || Date.now() > p.exp) return null;
    return p;
  }catch(_){ return null; }
}

/* ------------------------------- base58 / Ed25519 ------------------------- */
const B58_ALPHA = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58decode(s){
  const bytes = [0];
  for(const ch of s){
    const v = B58_ALPHA.indexOf(ch);
    if(v < 0) throw new Error("bad base58");
    let carry = v;
    for(let i = 0; i < bytes.length; i++){ const x = bytes[i] * 58 + carry; bytes[i] = x & 0xff; carry = x >> 8; }
    while(carry){ bytes.push(carry & 0xff); carry >>= 8; }
  }
  for(let i = 0; i < s.length && s[i] === B58_ALPHA[0]; i++) bytes.push(0);
  return new Uint8Array(bytes.reverse());
}
// Sign-In With Solana: the wallet signs our nonce, proving it holds the private key.
// workerd verifies Ed25519 natively, so this needs no library.
async function verifySolanaSignature(address, message, signatureB58){
  try{
    const pub = b58decode(address), sig = b58decode(signatureB58);
    if(pub.length !== 32 || sig.length !== 64) return false;
    const key = await crypto.subtle.importKey("raw", pub, { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "Ed25519" }, key, sig, new TextEncoder().encode(message));
  }catch(_){ return false; }
}
function loginMessage(nonce){
  return "Sign in to XZILLA: RUG SMASHER\n\nThis proves you own this wallet.\nIt is free and sends no transaction.\n\nNonce: " + nonce;
}

/* --------------------------------- Google -------------------------------- */
// Verifies a Google Identity Services ID token against Google's published keys.
// The JWKS is cached at the edge, so this costs one extra fetch per ~hour, not per login.
let _googleKeys = null, _googleKeysAt = 0;
async function googleKeys(){
  if(_googleKeys && Date.now() - _googleKeysAt < 3600000) return _googleKeys;
  const r = await fetch("https://www.googleapis.com/oauth2/v3/certs");
  const d = await r.json();
  _googleKeys = d.keys || []; _googleKeysAt = Date.now();
  return _googleKeys;
}
async function verifyGoogleToken(idToken, clientId){
  try{
    const [h, p, s] = String(idToken).split(".");
    if(!h || !p || !s) return null;
    const header  = JSON.parse(new TextDecoder().decode(b64urlDecode(h)));
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(p)));
    if(payload.aud !== clientId) return null;
    if(payload.iss !== "accounts.google.com" && payload.iss !== "https://accounts.google.com") return null;
    if(!payload.exp || Date.now() / 1000 > payload.exp) return null;
    const jwk = (await googleKeys()).find(k => k.kid === header.kid);
    if(!jwk) return null;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlDecode(s), new TextEncoder().encode(h + "." + p));
    if(!ok) return null;
    return payload;   // { sub, email, name, picture, ... }
  }catch(_){ return null; }
}

/* ------------------------------ unified identity -------------------------
   Every player endpoint calls this instead of verifyInitData, so Telegram and web
   players are indistinguishable downstream. Returns { pid, name, provider } or null. */
async function identify(req, env, body){
  // 1) Web session token (wallet / Google login)
  const auth = req.headers.get("Authorization") || "";
  if(auth.startsWith("Bearer ")){
    const sess = await readSession(env, auth.slice(7).trim());
    if(sess) return { pid: sess.pid, name: sess.name, provider: sess.pv };
  }
  // 2) Telegram Mini App initData (unchanged path for existing players)
  if(body && body.initData){
    const user = await verifyInitData(body.initData, env.BOT_TOKEN);
    if(user){
      const name = (user.username ? "@" + user.username : (user.first_name || "Player")).slice(0, 24);
      const who = await resolvePid(env, "tg", user.id, name);
      return { pid: who.pid, name: who.name, provider: "tg" };
    }
  }
  return null;
}

/* ============================== anti-cheat ================================
   Scores are client-reported. Until now the only thing making the board expensive
   to farm was that posting required a real Telegram account. Opening login to the
   web removes that barrier, so submissions are now bounded by what the run itself
   could plausibly have produced. Limits are deliberately loose — roughly 3x the
   best real run on the board — because wrongly rejecting a genuine record is far
   worse than letting an inflated-but-not-absurd one through. */
/* Limits are derived from the game's own worst-case maths, then doubled. A single
   kill can legitimately be worth base 20 (RUGGER + RUG RADAR) x combo 100 x tier 2.0
   x upgrades 1.78 (MIDAS + OVERCLOCK maxed) x PUMP 2 x SCORE-x2 2 = ~28,400 points.
   An earlier draft capped this at 4,000 and would have rejected real records — the
   asymmetry matters, since a wrongly-rejected genuine high score is far more damaging
   than an inflated one slipping through. */
const CHEAT = {
  perSecond: 60000,   // max score per second of elapsed run time (~4x the best real run)
  baseSlack: 50000,   // allowance for end-of-run bonuses
  perKill:   60000,   // ~2x the worst-case legitimate value of one kill
  perBoss:   120000,  // ~7x the worst-case legitimate boss kill
  minSeconds: 5,      // a run shorter than this cannot post a meaningful score
  noStatsMax: 2000000,// ceiling for legacy clients that send no telemetry (see implausible)
};
// Returns null if acceptable, or a short reason string if the run looks impossible.
function implausible(score, stats){
  const secs  = Number(stats && stats.secs)  || 0;
  const kills = Number(stats && stats.kills) || 0;
  const boss  = Number(stats && stats.boss)  || 0;
  if(score <= 0) return null;
  // ROLLOVER ALLOWANCE — clients cached before run telemetry shipped don't send `stats`,
  // and rejecting them would silently drop real players' scores until their browser
  // refetched game.js. So a statless submit is still accepted below this ceiling. It is
  // deliberately well above the best genuine run on the board (1.21M) and well below
  // MAX_SCORE, so it is already a large improvement on the previous 15M free-for-all.
  // Lower this to CHEAT.baseSlack once traffic has rolled over to the new client.
  if(secs <= 0) return score > CHEAT.noStatsMax ? "no_run_data" : null;
  if(secs < CHEAT.minSeconds && score > CHEAT.baseSlack) return "too_fast";
  if(score > CHEAT.perSecond * secs + CHEAT.baseSlack) return "rate";
  if(score > kills * CHEAT.perKill + boss * CHEAT.perBoss + CHEAT.baseSlack) return "unearned";
  return null;
}

// Cloudflare Turnstile — blocks scripted account creation. No-op until
// TURNSTILE_SECRET is set, so login keeps working before the widget exists.
//
// ORDER MATTERS: once the secret IS set, a login carrying no token is rejected. Ship the
// sitekey to the client BEFORE setting this, or every web player is locked out of signing
// in. (Telegram players are unaffected — they authenticate via initData, not this path.)
async function turnstileOk(env, token, ip){
  if(!env.TURNSTILE_SECRET) return true;
  if(!token) return false;
  try{
    const form = new FormData();
    form.append("secret", env.TURNSTILE_SECRET);
    form.append("response", token);
    if(ip) form.append("remoteip", ip);
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
    const d = await r.json();
    return !!d.success;
  }catch(_){ return false; }
}

/* ============================== daily run ==================================
   One shared seed per UTC day + its own board. utcDay() is the single source of
   truth for "which day is it" — the client derives the same string, and a submit
   for any day other than today is rejected so yesterday's board can't be edited. */
function utcDay(ts){
  const d = new Date(typeof ts === "number" ? ts : Date.now());
  return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0");
}
const DAY_RE     = /^\d{4}-\d{2}-\d{2}$/;
const DAILY_KEY  = day => "dlb:" + day;
const DAILY_KEEP = 200;
const DAILY_TTL  = 60 * 60 * 24 * 10;   // keep each day's board ~10 days, then let it expire

/* ============================== pump mode ==================================
   Live $XZILLA price drives a global game modifier, so the chart and the game
   feed each other. Thresholds live HERE (not in the client) so they can be
   retuned without shipping a new game.js / busting anyone's cache. */
const DEX_PAIR      = "8sfcazkfua9btfzccpa9nkjzgye8b5q89darghrezsew";   // solana pair (dexscreener)
const PUMP_TTL      = 60;     // seconds a FRESH price response is cached at the edge
const PUMP_FAIL_TTL = 20;     // shorter cache after a failed/stale read, so recovery is quick
const PUMP_LAST_KEY = "pump:last";
const PUMP_LAST_TTL = 3600;   // last-known-good survives an hour of upstream flakiness
const PUMP_WRITE_GAP = 600000;// ms between refreshes of the cached reading (KV write budget)

/* Dexscreener is inconsistent: the same pair returns full data one minute and
   {"schemaVersion":"1.0.0","pairs":null} the next (undocumented rate limiting).
   Try the pair endpoint, then fall back to the token endpoint and pick the
   deepest-liquidity Solana pair. Returns a pair object or null. */
async function fetchDexPair(env){
  const headers = { "accept": "application/json", "user-agent": "xzilla-game/1.0 (+https://xzilla.io)" };
  const pairId  = env.DEX_PAIR || DEX_PAIR;
  const mint    = env.XZILLA_MINT || XZILLA_MINT;

  try{
    const r = await fetch("https://api.dexscreener.com/latest/dex/pairs/solana/" + pairId, { headers });
    const d = await r.json().catch(() => null);
    // The endpoint returns `pairs` (array); some responses use `pair` (single object).
    const p = d ? (Array.isArray(d.pairs) && d.pairs[0]) || d.pair || null : null;
    if(p) return p;
  }catch(_){}

  try{
    const r = await fetch("https://api.dexscreener.com/latest/dex/tokens/" + mint, { headers });
    const d = await r.json().catch(() => null);
    const list = (d && Array.isArray(d.pairs)) ? d.pairs.filter(p => p && p.chainId === "solana") : [];
    if(list.length){
      list.sort((a, b) => ((b.liquidity && b.liquidity.usd) || 0) - ((a.liquidity && a.liquidity.usd) || 0));
      return list[0];
    }
  }catch(_){}

  return null;
}
function pumpModeFor(change24){
  if(!Number.isFinite(change24))  return { mode: "NORMAL", mult: 1,   xpMult: 1,   label: "",                 note: "" };
  if(change24 >= 15)              return { mode: "PUMP",   mult: 2,   xpMult: 1,   label: "🚀 PUMP MODE",     note: "$XZILLA is flying — DOUBLE score for everyone" };
  if(change24 >= 5)               return { mode: "GREEN",  mult: 1.5, xpMult: 1,   label: "🟢 GREEN CANDLE",  note: "$XZILLA is up — 1.5× score for everyone" };
  if(change24 <= -10)             return { mode: "BLOOD",  mult: 1,   xpMult: 1.5, label: "🩸 BLOOD MODE",    note: "Red day — scams hit harder, but XP pays 1.5×" };
  return { mode: "NORMAL", mult: 1, xpMult: 1, label: "", note: "" };
}

export default {
  async fetch(req, env){
    const origin = req.headers.get("Origin") || "*";
    if(req.method === "OPTIONS") return new Response(null, { headers: cors(origin) });
    const url = new URL(req.url);

    /* ===================== LOGIN — wallet (SIWS) + Google ===================
       GET  /auth/nonce   -> { nonce }            single-use, 5 min
       POST /auth/wallet  -> { ok, token, pid }   body { address, nonce, signature, turnstile? }
       POST /auth/google  -> { ok, token, pid }   body { credential, turnstile? }
       GET  /auth/me      -> { ok, pid, name }    Authorization: Bearer <token> */
    if(req.method === "GET" && url.pathname === "/auth/nonce"){
      if(!env.SESSION_SECRET) return json({ error: "login_unconfigured" }, 503, origin);
      const raw = crypto.getRandomValues(new Uint8Array(18));
      const nonce = [...raw].map(b => b.toString(16).padStart(2, "0")).join("");
      await env.LB.put(NONCE_PREFIX + nonce, "1", { expirationTtl: NONCE_TTL });
      return json({ nonce, message: loginMessage(nonce) }, 200, origin);
    }

    if(req.method === "POST" && url.pathname === "/auth/wallet"){
      if(!env.SESSION_SECRET) return json({ error: "login_unconfigured" }, 503, origin);
      let body; try{ body = await req.json(); }catch(_){ return json({ error: "bad json" }, 400, origin); }
      const address = String(body.address || "").trim();
      const nonce   = String(body.nonce || "").trim();
      if(!B58_RE.test(address) || !/^[a-f0-9]{20,80}$/.test(nonce)) return json({ error: "bad_request" }, 400, origin);
      if(!(await turnstileOk(env, body.turnstile, req.headers.get("CF-Connecting-IP")))) return json({ error: "captcha_failed" }, 403, origin);

      // Burn the nonce FIRST so a captured signature can't be replayed, even if
      // two requests race — KV delete is the single point that makes it single-use.
      const nk = NONCE_PREFIX + nonce;
      if(!(await env.LB.get(nk))) return json({ error: "nonce_expired" }, 401, origin);
      await env.LB.delete(nk);

      if(!(await verifySolanaSignature(address, loginMessage(nonce), String(body.signature || ""))))
        return json({ error: "bad_signature" }, 401, origin);

      const short = address.slice(0, 4) + "…" + address.slice(-4);
      const who = await resolvePid(env, "wallet", address, short);
      const token = await issueSession(env, who.pid, who.name, "wallet");
      return json({ ok: true, token, pid: who.pid, name: who.name, tag: await shortTag(who.pid) }, 200, origin);
    }

    if(req.method === "POST" && url.pathname === "/auth/google"){
      if(!env.SESSION_SECRET) return json({ error: "login_unconfigured" }, 503, origin);
      if(!env.GOOGLE_CLIENT_ID) return json({ error: "google_unconfigured" }, 503, origin);
      let body; try{ body = await req.json(); }catch(_){ return json({ error: "bad json" }, 400, origin); }
      if(!(await turnstileOk(env, body.turnstile, req.headers.get("CF-Connecting-IP")))) return json({ error: "captcha_failed" }, 403, origin);
      const payload = await verifyGoogleToken(body.credential || "", env.GOOGLE_CLIENT_ID);
      if(!payload) return json({ error: "bad_token" }, 401, origin);
      // Display name: prefer the given name, never the raw email (it would land on a public board).
      const nm = (payload.given_name || payload.name || (payload.email || "").split("@")[0] || "Player").slice(0, 24);
      const who = await resolvePid(env, "google", payload.sub, nm);
      const token = await issueSession(env, who.pid, who.name, "google");
      return json({ ok: true, token, pid: who.pid, name: who.name, tag: await shortTag(who.pid) }, 200, origin);
    }

    /* ===================== DISCORD OAUTH2 ==================================
       Authorization Code grant (docs.discord.com/developers/topics/oauth2).
       The token exchange needs the client SECRET, so it has to happen here, never
       in the game.

       The session token is handed back the same way the Phantom bridge does it:
       the callback stores the result in KV under a client-generated sid and the
       game polls for it. Redirecting back to the game with the token in the query
       string would leak it into browser history, the Referer header, and any
       analytics on the page — a session token is a bearer credential.

       Both halves are switchable: no DISCORD_CLIENT_ID/SECRET means the endpoints
       report discord_unconfigured and the game hides the button, exactly like the
       existing google_unconfigured path. ====================================== */
    const DSID_RE  = /^[a-f0-9]{16,64}$/;
    const DPEND    = "dpend:";     // dpend:<sid> -> "1"        (state, proves we started it)
    const DRES     = "dres:";      // dres:<sid>  -> {token,...} (result, one-time read)
    const DTTL     = 600;          // 10 min to complete a login
    const discordOn = () => !!(env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET);
    const discordRedirect = () => (env.DISCORD_REDIRECT_URI || (url.origin + "/auth/discord/callback"));

    // What the game can offer. Lets the sign-in sheet hide buttons that cannot work
    // rather than showing one that fails only after the player clicks it.
    if(req.method === "GET" && url.pathname === "/auth/providers"){
      return json({ discord: discordOn(), google: !!env.GOOGLE_CLIENT_ID, wallet: !!env.SESSION_SECRET }, 200, origin);
    }

    // Step 1 — send the player to Discord. `state` is the sid, and it is recorded in KV
    // first so the callback can prove the flow started here (CSRF guard).
    if(req.method === "GET" && url.pathname === "/auth/discord/start"){
      if(!env.SESSION_SECRET) return json({ error: "login_unconfigured" }, 503, origin);
      if(!discordOn())        return json({ error: "discord_unconfigured" }, 503, origin);
      const sid = (url.searchParams.get("sid") || "").trim();
      if(!DSID_RE.test(sid)) return json({ error: "bad_sid" }, 400, origin);
      await env.LB.put(DPEND + sid, "1", { expirationTtl: DTTL });
      const auth = "https://discord.com/oauth2/authorize"
        + "?client_id=" + encodeURIComponent(env.DISCORD_CLIENT_ID)
        + "&redirect_uri=" + encodeURIComponent(discordRedirect())
        + "&response_type=code"
        + "&scope=" + encodeURIComponent("identify")     // identify only — no email, no guilds
        + "&state=" + encodeURIComponent(sid)
        + "&prompt=none";                                 // skip re-consent for returning players
      return Response.redirect(auth, 302);
    }

    // Step 2 — Discord sends the player back here with ?code=&state=
    if(req.method === "GET" && url.pathname === "/auth/discord/callback"){
      const done = (msg, ok) => new Response(
        `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`+
        `<body style="background:#0b0f1a;color:#e8f6ff;font-family:system-ui,sans-serif;display:flex;align-items:center;`+
        `justify-content:center;min-height:100vh;margin:0;text-align:center">`+
        `<div style="padding:24px;max-width:340px"><div style="font-size:46px">${ok?"🦖":"⚠"}</div>`+
        `<h2 style="color:${ok?"#39ff7a":"#ff3b5c"};margin:.3em 0">${msg}</h2>`+
        `<p style="opacity:.75">${ok?"You can close this tab and return to the game.":"Close this tab and try again."}</p></div>`+
        `<script>setTimeout(function(){try{window.close()}catch(e){}},${ok?1200:4000})</script>`,
        { status: 200, headers: { "content-type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });

      if(!discordOn()) return done("Discord login is not configured", false);
      const code  = (url.searchParams.get("code")  || "").trim();
      const state = (url.searchParams.get("state") || "").trim();
      if(!code || !DSID_RE.test(state)) return done("Login link was invalid", false);
      // Burn the state first: it is single-use, so a replayed callback cannot mint a
      // second session even if the URL is captured.
      if(!(await env.LB.get(DPEND + state))) return done("Login expired — start again", false);
      await env.LB.delete(DPEND + state);

      try{
        const tok = await fetch("https://discord.com/api/oauth2/token", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: env.DISCORD_CLIENT_ID,
            client_secret: env.DISCORD_CLIENT_SECRET,
            grant_type: "authorization_code",
            code,
            redirect_uri: discordRedirect(),
          }),
        }).then(r => r.json());
        if(!tok || !tok.access_token) return done("Discord rejected the login", false);

        const me = await fetch("https://discord.com/api/users/@me", {
          headers: { Authorization: "Bearer " + tok.access_token },
        }).then(r => r.json());
        if(!me || !me.id) return done("Could not read your Discord profile", false);

        // The handle, not the display name: username is unique account-wide, while
        // global_name is a free-text nickname two people can share.
        const nm  = String(me.username || me.global_name || "Player").slice(0, 24);
        const who = await resolvePid(env, "discord", me.id, nm);
        const token = await issueSession(env, who.pid, who.name, "discord");
        await env.LB.put(DRES + state, JSON.stringify({
          ok: true, token, pid: who.pid, name: who.name, tag: await shortTag(who.pid),
        }), { expirationTtl: DTTL });
        return done("Signed in as " + who.name, true);
      }catch(e){
        return done("Discord login failed", false);
      }
    }

    // Step 3 — the game polls this until the callback lands. One-time read.
    if(req.method === "GET" && url.pathname === "/auth/discord/result"){
      const sid = (url.searchParams.get("sid") || "").trim();
      if(!DSID_RE.test(sid)) return json({ error: "bad_sid" }, 400, origin);
      const v = await env.LB.get(DRES + sid);
      if(!v) return json({ ready: false }, 200, origin);
      await env.LB.delete(DRES + sid);
      let rec; try{ rec = JSON.parse(v); }catch(_){ rec = {}; }
      return json({ ready: true, ...rec }, 200, origin);
    }

    if(req.method === "GET" && url.pathname === "/auth/me"){
      const me = await identify(req, env, null);
      if(!me) return json({ ok: false }, 401, origin);
      return json({ ok: true, pid: me.pid, name: me.name, provider: me.provider, tag: await shortTag(me.pid) }, 200, origin);
    }

    if(req.method === "GET" && url.pathname === "/top"){
      const list = JSON.parse((await env.LB.get(TOP_KEY)) || "[]");
      // tier/hold ride along so the board can show WHO ACTUALLY HOLDS — the whole point
      // of the multiplier is that other players can see it.
      return json({ top: await withTags(list.slice(0, 10)) }, 200, origin);
    }

    /* ===================== PUMP MODE — live $XZILLA price ===================
       Public, cached, no auth. Returns both the raw market data (so the start
       screen can show the chart) and the derived game modifier. */
    if(req.method === "GET" && url.pathname === "/pump"){
      const cacheKey = new Request(new URL("/pump", req.url).toString());
      const cached = await caches.default.match(cacheKey);
      if(cached) return cached;
      let payload = { ok: false, mode: "NORMAL", mult: 1, xpMult: 1, label: "", note: "" };
      try{
        const p = await fetchDexPair(env);
        if(p){
          const change24 = Number(p.priceChange && p.priceChange.h24);
          payload = {
            ok: true,
            priceUsd: Number(p.priceUsd) || 0,
            change24: Number.isFinite(change24) ? change24 : null,
            mcap: Number(p.marketCap || p.fdv) || 0,
            vol24: Number(p.volume && p.volume.h24) || 0,
            liq: Number(p.liquidity && p.liquidity.usd) || 0,
            ...pumpModeFor(change24),
          };
        } else { payload.err = "no_pair"; }
      }catch(_){ payload.err = "fetch_failed"; }

      if(payload.ok){
        // Remember the last good reading. Dexscreener is heavily rate-limited and
        // frequently answers {"pairs":null} even for a live pair, so without this the
        // game would flicker in and out of PUMP MODE all day.
        //
        // Refreshed at most every PUMP_WRITE_GAP rather than on every poll: the edge cache
        // already limits upstream calls to ~1/min, and blindly persisting each one would
        // spend ~1,440 KV writes/day — more than the entire free-tier daily allowance, for
        // a value that barely moves. A mode CHANGE still writes immediately, so the game
        // never lags behind an actual pump.
        let prevMode = null, prevAt = 0;
        try{
          const cached = JSON.parse((await env.LB.get(PUMP_LAST_KEY)) || "null");
          if(cached){ prevMode = cached.mode; prevAt = cached.at || 0; }
        }catch(_){}
        if(prevMode !== payload.mode || (Date.now() - prevAt) > PUMP_WRITE_GAP){
          await env.LB.put(PUMP_LAST_KEY, JSON.stringify({ ...payload, at: Date.now() }), { expirationTtl: PUMP_LAST_TTL });
        }
      } else {
        const last = await env.LB.get(PUMP_LAST_KEY);
        if(last){
          try{ payload = { ...JSON.parse(last), stale: true }; }catch(_){}
        }
      }

      const res = new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json", "Cache-Control": "public, max-age=" + PUMP_TTL, ...cors(origin) },
      });
      // Cache fresh readings for the full window; cache a stale/failed one only briefly, so
      // the next real reading isn't held back — but still bound how often we call upstream.
      const ttl = payload.ok && !payload.stale ? PUMP_TTL : PUMP_FAIL_TTL;
      await caches.default.put(cacheKey, new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json", "Cache-Control": "public, max-age=" + ttl, ...cors(origin) },
      }));
      return res;
    }

    /* ===================== DAILY RUG RUN — one seed, one shot ===============
       GET /daily-top?day=YYYY-MM-DD  -> { day, seed, top: [...] }
       POST /daily-submit             -> { ok, rank, top }  body { initData, score, day }
       The server keeps each user's FIRST submitted score for the day: the mode is
       one-attempt-only, so a second post is a retry attempt and is ignored rather
       than allowed to overwrite. (The client also locks the button locally; this is
       the half that actually enforces it.) */
    if(req.method === "GET" && url.pathname === "/daily-top"){
      const day = DAY_RE.test(url.searchParams.get("day") || "") ? url.searchParams.get("day") : utcDay();
      const list = JSON.parse((await env.LB.get(DAILY_KEY(day))) || "[]");
      return json({
        day,
        top: await withTags(list.slice(0, 20)),
        players: list.length,
      }, 200, origin);
    }

    /* Has THIS PLAYER already used today's daily run?
       The client also keeps a local record, but that is per-device: it wrongly locks a
       player who signs in with a different account on the same browser, and fails to
       lock the same account on a second device. The account is the thing the attempt
       belongs to, so the server is the authority and the local copy is only a fallback
       for guests. POST (not GET) so Telegram clients can pass initData in the body. */
    if(req.method === "POST" && url.pathname === "/daily-status"){
      let body; try{ body = await req.json(); }catch(_){ body = {}; }
      const me = await identify(req, env, body);
      const today = utcDay();
      if(!me) return json({ day: today, played: false, anon: true }, 200, origin);
      const list = JSON.parse((await env.LB.get(DAILY_KEY(today))) || "[]");
      const sorted = list.slice().sort((a, b) => b.score - a.score);
      const i = sorted.findIndex(e => e.id === me.pid);
      return json({
        day: today,
        played: i >= 0,
        score: i >= 0 ? sorted[i].score : 0,
        rank:  i >= 0 ? i + 1 : 0,
        players: list.length,
        you: await shortTag(me.pid),
      }, 200, origin);
    }

    if(req.method === "POST" && url.pathname === "/daily-submit"){
      let body;
      try{ body = await req.json(); }catch(_){ return json({ error: "bad json" }, 400, origin); }
      const me = await identify(req, env, body);
      if(!me) return json({ error: "unauthorized" }, 401, origin);
      const score = Math.max(0, Math.round(Number(body.score) || 0));
      if(score > MAX_SCORE) return json({ error: "score_rejected" }, 400, origin);
      // Everyone plays the SAME seed on a given day, so an impossible daily score is
      // impossible for every player alike — the plausibility check bites hardest here.
      const badDaily = implausible(score, body.stats);
      if(badDaily) return json({ error: "score_rejected", reason: badDaily }, 400, origin);
      const today = utcDay();
      // Only today's board is writable — no back-filling yesterday once its seed is known.
      if(body.day && body.day !== today) return json({ error: "stale_day", day: today }, 409, origin);

      const id   = me.pid;
      const name = me.name;
      const key  = DAILY_KEY(today);
      const list = JSON.parse((await env.LB.get(key)) || "[]");
      const idx  = list.findIndex(e => e.id === id);

      if(idx >= 0){
        // Already ran today — report their standing, write nothing.
        const sorted = list.slice().sort((a, b) => b.score - a.score);
        return json({
          ok: true, already: true,
          rank: sorted.findIndex(e => e.id === id) + 1,
          score: list[idx].score,
          top: await withTags(sorted.slice(0, 20)),
          you: await shortTag(me.pid),
        }, 200, origin);
      }

      let tier = null;
      const wallet = String(body.wallet || "").trim();
      if(B58_RE.test(wallet)){
        const bal = await cachedBalance(wallet, env);
        if(bal !== null){ const t = tierFor(bal); if(t) tier = t.l; }
      }

      list.push({ id, name, score, tier });
      list.sort((a, b) => b.score - a.score);
      const trimmed = list.slice(0, DAILY_KEEP);
      await env.LB.put(key, JSON.stringify(trimmed), { expirationTtl: DAILY_TTL });
      return json({
        ok: true,
        rank: trimmed.findIndex(e => e.id === id) + 1,
        players: trimmed.length,
        top: await withTags(trimmed.slice(0, 20)),
        you: await shortTag(me.pid),
      }, 200, origin);
    }

    if(req.method === "POST" && url.pathname === "/submit"){
      let body;
      try{ body = await req.json(); }catch(_){ return json({ error: "bad json" }, 400, origin); }
      const score = Math.max(0, Math.round(Number(body.score) || 0));
      const me = await identify(req, env, body);
      if(!me) return json({ error: "unauthorized" }, 401, origin);
      const id   = me.pid;
      const name = me.name;

      // (1) SANITY CAP — reject impossible scores instead of recording them.
      if(score > MAX_SCORE) return json({ error: "score_rejected" }, 400, origin);
      // (1b) PLAUSIBILITY — bound the score by what the run could have produced.
      const bad = implausible(score, body.stats);
      if(bad) return json({ error: "score_rejected", reason: bad }, 400, origin);

      const list = JSON.parse((await env.LB.get(TOP_KEY)) || "[]");
      const idx  = list.findIndex(e => e.id === id);
      const prev = idx >= 0 ? list[idx].score : -1;

      // HOLDER TIER — re-read the balance server-side so the badge on the public board
      // is earned, not claimed. A failed/absent read leaves the PREVIOUS tier in place
      // rather than clearing it, so an RPC blip doesn't visibly demote a real holder.
      let tier = idx >= 0 ? (list[idx].tier || null) : null;
      let hold = idx >= 0 ? (list[idx].hold  || 0)    : 0;
      const wallet = String(body.wallet || "").trim();
      if(B58_RE.test(wallet)){
        const bal = await cachedBalance(wallet, env);
        if(bal !== null){
          const t = tierFor(bal);
          tier = t ? t.l : null;      // a real read that comes back under 1M DOES clear the badge
          hold = Math.round(bal);
        }
      }

      // A genuine NEW PERSONAL BEST is ALWAYS recorded — it must never be dropped just
      // because it landed soon after the previous run (the client re-posts your best on
      // every game-over, and short runs/quick retries used to trip the old blanket rate
      // limiter, losing real high scores). Non-improving resubmits are the spam case, and
      // they're handled below WITHOUT a write, so no rate limiter is needed for correctness.
      if(score <= prev){
        // Not an improvement — throttle churn but still report the player's standing.
        // Exception: a freshly verified tier change IS persisted, so a player who just
        // bought in sees their badge appear without having to beat their own record.
        const tierChanged = idx >= 0 && (list[idx].tier !== tier || (list[idx].hold || 0) !== hold);
        if(tierChanged){
          list[idx].tier = tier; list[idx].hold = hold;
          await env.LB.put(TOP_KEY, JSON.stringify(list));
        }
        const tsKey = "ts:" + id, now = Date.now();
        const last = parseInt((await env.LB.get(tsKey)) || "0", 10);
        if(!(last && (now - last) < RATE_MS)) await env.LB.put(tsKey, String(now));
        const sorted = list.slice().sort((a, b) => b.score - a.score);
        const rank = sorted.findIndex(e => e.id === id) + 1;
        return json({ ok: true, rank, tier, you: await shortTag(id), top: await withTags(sorted.slice(0, 10)) }, 200, origin);
      }

      // record the new best
      if(idx >= 0){ list[idx].score = score; list[idx].name = name; list[idx].tier = tier; list[idx].hold = hold; }
      else { list.push({ id, name, score, tier, hold }); }
      list.sort((a, b) => b.score - a.score);
      const trimmed = list.slice(0, MAX_KEEP);
      await env.LB.put(TOP_KEY, JSON.stringify(trimmed));
      const rank = trimmed.findIndex(e => e.id === id) + 1;
      return json({ ok: true, rank, tier, you: await shortTag(id), top: await withTags(trimmed.slice(0, 10)) }, 200, origin);
    }

    // ===================== Per-user economy (cross-device XP/upgrades) ===========
    // Saved server-side keyed to the verified Telegram user (same trust model as /submit:
    // identity is verified, the values are client-reported). Makes XP/upgrades reliable
    // across devices instead of depending on per-device localStorage / flaky CloudStorage.
    const ECON_PREFIX = "econ:";
    const ECON_MAX_BYTES = 8000;

    if(req.method === "POST" && url.pathname === "/econ-load"){
      let body; try{ body = await req.json(); }catch(_){ return json({ error: "bad json" }, 400, origin); }
      const me = await identify(req, env, body);
      if(!me) return json({ error: "unauthorized" }, 401, origin);
      const v = await env.LB.get(ECON_PREFIX + me.pid);
      let snap = null; try{ snap = v ? JSON.parse(v) : null; }catch(_){ snap = null; }
      return json({ ok: true, snap }, 200, origin);
    }

    if(req.method === "POST" && url.pathname === "/econ-save"){
      let body; try{ body = await req.json(); }catch(_){ return json({ error: "bad json" }, 400, origin); }
      const me = await identify(req, env, body);
      if(!me) return json({ error: "unauthorized" }, 401, origin);
      const snap = body.snap;
      if(!snap || typeof snap !== "object" || Array.isArray(snap)) return json({ error: "bad_snap" }, 400, origin);
      const s = JSON.stringify(snap);
      if(s.length > ECON_MAX_BYTES) return json({ error: "too_large" }, 413, origin);
      await env.LB.put(ECON_PREFIX + me.pid, s);
      return json({ ok: true }, 200, origin);
    }

    // ===================== Double-sided referrals (XP only) =====================
    // Each player shares t.me/<bot>?startapp=<their-id>. When a NEW user opens via that
    // link, /refer marks them (one-time) and credits the referrer's pending bucket; the
    // new user gets an immediate welcome bonus. The referrer claims their pending XP on
    // their next launch via /refer-claim. XP only — no token payouts.
    const REF_REFERRER_REWARD = 3000;   // XP to the inviter per confirmed friend
    const REF_INVITEE_REWARD  = 2500;   // XP welcome bonus to the new player
    const REFERRED_PREFIX = "referred:";  // referred:<inviteeId> = referrerId (one-time marker)
    const REFPEND_PREFIX  = "refpend:";   // refpend:<referrerId>  = unclaimed XP
    const REFCOUNT_PREFIX = "refcount:";  // refcount:<referrerId> = total confirmed referrals
    const REFLB_KEY       = "reflb:v1";   // public TOP INVITERS board: [{id,name,count}]
    const ID_RE = /^[0-9]{1,20}$/;

    if(req.method === "POST" && url.pathname === "/refer"){
      let body; try{ body = await req.json(); }catch(_){ return json({ error: "bad json" }, 400, origin); }
      const me = await identify(req, env, body);
      if(!me) return json({ error: "unauthorized" }, 401, origin);
      const invitee = me.pid;
      const ref = String(body.ref || "").trim();
      if(!ID_RE.test(ref) || ref === invitee) return json({ ok:true, welcome:0 }, 200, origin);   // bad/self ref → no-op
      if(await env.LB.get(REFERRED_PREFIX + invitee)) return json({ ok:true, welcome:0, already:true }, 200, origin);  // one-time
      await env.LB.put(REFERRED_PREFIX + invitee, ref);
      const pend  = (parseInt(await env.LB.get(REFPEND_PREFIX + ref), 10) || 0) + REF_REFERRER_REWARD;
      const count = (parseInt(await env.LB.get(REFCOUNT_PREFIX + ref), 10) || 0) + 1;
      await env.LB.put(REFPEND_PREFIX + ref, String(pend));
      await env.LB.put(REFCOUNT_PREFIX + ref, String(count));
      // maintain the public top-inviters board (name filled in when the referrer next opens)
      const board = JSON.parse((await env.LB.get(REFLB_KEY)) || "[]");
      const e = board.find(x => x.id === ref);
      if(e) e.count = count; else board.push({ id: ref, name: "Player", count });
      board.sort((a, b) => b.count - a.count);
      await env.LB.put(REFLB_KEY, JSON.stringify(board.slice(0, 200)));
      return json({ ok:true, welcome: REF_INVITEE_REWARD }, 200, origin);
    }

    if(req.method === "POST" && url.pathname === "/refer-claim"){
      let body; try{ body = await req.json(); }catch(_){ return json({ error: "bad json" }, 400, origin); }
      const me = await identify(req, env, body);
      if(!me) return json({ error: "unauthorized" }, 401, origin);
      const id = me.pid;
      const reward = parseInt(await env.LB.get(REFPEND_PREFIX + id), 10) || 0;
      const count  = parseInt(await env.LB.get(REFCOUNT_PREFIX + id), 10) || 0;
      if(reward > 0) await env.LB.delete(REFPEND_PREFIX + id);   // one-time claim
      // stamp the inviter's real name onto the board now that they've authenticated
      if(count > 0){
        const name = me.name;
        const board = JSON.parse((await env.LB.get(REFLB_KEY)) || "[]");
        const e = board.find(x => x.id === id);
        if(e && e.name !== name){ e.name = name; await env.LB.put(REFLB_KEY, JSON.stringify(board)); }
      }
      return json({ ok:true, reward, count }, 200, origin);
    }

    // -------- GET /refer-top  (public) — TOP INVITERS board ----------------------
    if(req.method === "GET" && url.pathname === "/refer-top"){
      const board = JSON.parse((await env.LB.get(REFLB_KEY)) || "[]");
      return new Response(JSON.stringify({ ok:true, top: board.slice(0, 10).map(e => ({ name:e.name, count:e.count })) }), {
        status: 200, headers: { "content-type": "application/json", "Cache-Control": "public, max-age=15", "Access-Control-Allow-Origin": "*" },
      });
    }

    // -------- GET /ads  (public, no-store) ---------------------------------------
    // Live ad config for the in-game billboards. Served from KV with no caching so an
    // update via POST /ads is visible to players within seconds (vs. ~5 min on the
    // GitHub-raw CDN). Shape: { messages: [ "TEXT" | {text,color,imageUrl,clickLink} ] }.
    if(req.method === "GET" && url.pathname === "/ads"){
      // 15s edge cache so many players polling doesn't hammer KV; purged on POST below.
      // Public read-only data → ACAO:* (avoids per-origin cached-CORS issues).
      const cacheKey = new Request(new URL("/ads", req.url).toString());
      const hit = await caches.default.match(cacheKey);
      if(hit) return hit;
      const v = await env.LB.get(ADS_KEY);
      const res = new Response(v || '{"messages":[]}', {
        status: 200,
        headers: { "content-type": "application/json", "Cache-Control": "public, max-age=15", "Access-Control-Allow-Origin": "*" },
      });
      await caches.default.put(cacheKey, res.clone());
      return res;
    }

    // -------- POST /ads  (admin: header x-admin-token === env.ADS_ADMIN_TOKEN) ----
    // Replace the live ad config. Body is the ads JSON (an array, or {messages:[...]}).
    if(req.method === "POST" && url.pathname === "/ads"){
      if(!env.ADS_ADMIN_TOKEN || req.headers.get("x-admin-token") !== env.ADS_ADMIN_TOKEN)
        return json({ error: "unauthorized" }, 401, origin);
      const text = await req.text();
      if(text.length > ADS_MAX_BYTES) return json({ error: "too_large" }, 413, origin);
      let parsed;
      try{ parsed = JSON.parse(text); }catch(_){ return json({ error: "bad_json" }, 400, origin); }
      // Accept grouped {wide,square,tall}, legacy {messages:[...]}, or a bare array (→ wide).
      let cfg, count = 0;
      if(Array.isArray(parsed)){ cfg = { wide: parsed }; count = parsed.length; }
      else if(parsed && typeof parsed === "object"){
        if(Array.isArray(parsed.messages)){ cfg = { wide: parsed.messages }; count = parsed.messages.length; }
        else {
          cfg = {};
          for(const k of AD_GROUP_KEYS){ if(Array.isArray(parsed[k])){ cfg[k] = parsed[k]; count += parsed[k].length; } }
          if(!Object.keys(cfg).length) return json({ error: "expected {wide,square,tall} arrays or {messages:[...]}" }, 400, origin);
        }
      } else return json({ error: "bad_format" }, 400, origin);
      await env.LB.put(ADS_KEY, JSON.stringify(cfg));
      try{ await caches.default.delete(new Request(new URL("/ads", req.url).toString())); }catch(_){}   // purge edge cache so the update is live immediately
      return json({ ok: true, count }, 200, origin);
    }

    // -------- POST /ad-image  (admin) — store an uploaded image, return its URL -----
    // Body is the raw image bytes; Content-Type must be an image/*. Lets the admin page
    // upload a picture directly (no external host). Stored in KV, served by GET below.
    if(req.method === "POST" && url.pathname === "/ad-image"){
      if(!env.ADS_ADMIN_TOKEN || req.headers.get("x-admin-token") !== env.ADS_ADMIN_TOKEN)
        return json({ error: "unauthorized" }, 401, origin);
      const ct = (req.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      if(!IMG_TYPES.includes(ct)) return json({ error: "unsupported_type", detail: ct }, 415, origin);
      const buf = await req.arrayBuffer();
      if(buf.byteLength === 0) return json({ error: "empty" }, 400, origin);
      if(buf.byteLength > IMG_MAX_BYTES) return json({ error: "too_large", maxBytes: IMG_MAX_BYTES }, 413, origin);
      const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
      await env.LB.put(IMG_PREFIX + id, buf, { metadata: { ct } });
      return json({ ok: true, id, url: url.origin + "/ad-image/" + id }, 200, origin);
    }

    // -------- GET /ad-image/<id>  (public) — serve a stored image (CORS for canvas) --
    if(req.method === "GET" && url.pathname.startsWith("/ad-image/")){
      const id = url.pathname.slice("/ad-image/".length);
      if(!/^[a-f0-9]{8,32}$/.test(id)) return json({ error: "bad_id" }, 400, origin);
      const { value, metadata } = await env.LB.getWithMetadata(IMG_PREFIX + id, { type: "arrayBuffer" });
      if(!value) return json({ error: "not_found" }, 404, origin);
      return new Response(value, { status: 200, headers: {
        "content-type": (metadata && metadata.ct) || "image/png",
        "Cache-Control": "public, max-age=604800",
        "Access-Control-Allow-Origin": "*",   // canvas (crossOrigin=anonymous) needs this
      }});
    }

    // -------- GET /balance?address=<pubkey> --------------------------------------
    // Server-side $XZILLA balance read via Helius (API key hidden in env.HELIUS_KEY).
    // Keeps the RPC key off the client and sidesteps the public-RPC rate-limits/CORS
    // that made the in-browser balance check fail. Returns { ok, balance, holder }.
    if(req.method === "GET" && url.pathname === "/balance"){
      const address = (url.searchParams.get("address") || "").trim();
      if(!B58_RE.test(address)) return json({ error: "bad_address" }, 400, origin);
      if(!env.HELIUS_KEY) return json({ error: "rpc_unconfigured" }, 500, origin);
      const mint = env.XZILLA_MINT || XZILLA_MINT;

      // short-lived edge cache so repeated taps don't hammer the Helius quota (per address)
      const cacheKey = new Request(new URL("/balance?address=" + address, req.url).toString());
      const cached = await caches.default.match(cacheKey);
      if(cached) return cached;

      try{
        const rpcRes = await fetch("https://mainnet.helius-rpc.com/?api-key=" + env.HELIUS_KEY, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0", id: 1, method: "getTokenAccountsByOwner",
            params: [ address, { mint }, { encoding: "jsonParsed" } ],
          }),
        });
        const data = await rpcRes.json();
        if(data.error) return json({ error: "rpc_error", detail: data.error.message || "" }, 502, origin);
        let balance = 0;
        for(const acc of (data.result && data.result.value) || []){
          const info = acc && acc.account && acc.account.data && acc.account.data.parsed && acc.account.data.parsed.info;
          const amt = info && info.tokenAmount && info.tokenAmount.uiAmount;
          if(typeof amt === "number") balance += amt;
        }
        const res = new Response(JSON.stringify({ ok: true, address, balance, holder: balance > 0 }), {
          status: 200,
          headers: { "content-type": "application/json", "Cache-Control": "public, max-age=30", ...cors(origin) },
        });
        await caches.default.put(cacheKey, res.clone());   // cache the success for 30s
        return res;
      }catch(_){
        return json({ error: "rpc_unreachable" }, 502, origin);
      }
    }

    // ===================== Phantom deeplink relay (Telegram Mini App) ===========
    // Inside Telegram there's no injected wallet and WalletConnect can't do
    // Solana+Phantom, so the client uses Phantom's connect deeplink. Phantom can't
    // redirect back INTO a Telegram Mini App, so it redirects here instead: we stash
    // the (already end-to-end-encrypted) connect response under a client-chosen
    // session id, and the still-open Telegram client polls /phantom-result for it.
    // The payload is encrypted to the client's ephemeral key — useless to anyone
    // else even if a sid leaked — so this relay is a dumb, short-lived mailbox.
    const PCB_PREFIX = "pcb:";
    const PCB_TTL    = 300;                       // seconds a pending result survives
    const SID_RE     = /^[a-f0-9]{16,64}$/;       // client-generated hex session id
    const PK_RE      = /^[1-9A-HJ-NP-Za-km-z]{32,64}$/;     // base58 pubkey / nonce
    const DATA_RE    = /^[1-9A-HJ-NP-Za-km-z]{1,4000}$/;    // encrypted payload (incl. session token) can be long

    // Bridge page: opened in the SYSTEM browser (via Telegram.openLink). Launching
    // Phantom directly from Telegram's webview is unreliable, but from a real browser
    // page the universal link hands off to the native app cleanly. The page reads the
    // session id + the client's ephemeral public key from its own URL, builds the
    // Phantom connect deeplink (redirect_link -> /phantom-cb), and launches it.
    if(req.method === "GET" && url.pathname === "/phantom-bridge"){
      const html = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect Phantom</title></head>
<body style="background:#0b0f1a;color:#e8f6ff;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center">
<div style="padding:24px;max-width:340px">
<div style="font-size:46px">🦖</div>
<h2 style="color:#21e6ff;margin:.3em 0">Connect Phantom</h2>
<p id="msg" style="opacity:.85">Opening Phantom…</p>
<a id="go" href="#" style="display:inline-block;margin-top:10px;padding:14px 22px;background:#ab9ff2;color:#1a1030;font-weight:700;border-radius:12px;text-decoration:none">Open Phantom</a>
<p style="opacity:.6;font-size:13px;margin-top:18px">After approving in Phantom, return to the XZILLA game in Telegram.</p>
</div>
<script>
(function(){
  var q=new URLSearchParams(location.search);
  var sid=q.get("sid")||"", pk=q.get("pk")||"";
  if(!/^[a-f0-9]{16,64}$/.test(sid) || !pk){ document.getElementById("msg").textContent="Invalid connect link — reopen from the game."; document.getElementById("go").style.display="none"; return; }
  // Phantom requires redirect_link origin === app_url origin, so both must be THIS
  // (the bridge/relay) origin. The game URL is passed only for display below.
  var app=location.origin;
  var cb=location.origin+"/phantom-cb?sid="+encodeURIComponent(sid);
  var link="https://phantom.app/ul/v1/connect?dapp_encryption_public_key="+encodeURIComponent(pk)
    +"&cluster=mainnet-beta&app_url="+encodeURIComponent(app)+"&redirect_link="+encodeURIComponent(cb);
  document.getElementById("go").href=link;
  setTimeout(function(){ try{ window.location.href=link; }catch(e){} }, 350);   // auto-launch; button is the fallback
})();
</script></body></html>`;
      return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
    }

    // Desktop helper: opened in the user's real browser (via Telegram Desktop's openLink).
    // Telegram Desktop's webview has no extension, but the user's normal browser does — so
    // this page connects via the Phantom EXTENSION and posts the plain address to the relay,
    // which the still-open Telegram Desktop client polls. (Mobile uses the direct deeplink.)
    if(req.method === "GET" && url.pathname === "/phantom-desktop"){
      const html = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect Phantom</title></head>
<body style="background:#0b0f1a;color:#e8f6ff;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center">
<div style="padding:24px;max-width:360px">
<div style="font-size:46px">🦖</div>
<h2 style="color:#21e6ff;margin:.3em 0">Connect Phantom</h2>
<p id="msg" style="opacity:.85">Looking for your Phantom extension…</p>
<a id="go" href="#" style="display:none;margin-top:10px;padding:14px 22px;background:#ab9ff2;color:#1a1030;font-weight:700;border-radius:12px;text-decoration:none">Retry</a>
<p style="opacity:.6;font-size:13px;margin-top:18px">Approve in Phantom, then return to the XZILLA game in Telegram.</p>
</div>
<script>
(function(){
  var q=new URLSearchParams(location.search), sid=q.get("sid")||"";
  var msg=document.getElementById("msg"), btn=document.getElementById("go");
  if(!/^[a-f0-9]{16,64}$/.test(sid)){ msg.textContent="Invalid link — reopen from the game."; return; }
  function prov(){ if(window.phantom&&window.phantom.solana) return window.phantom.solana; if(window.solana) return window.solana; return null; }
  async function go(){
    var p=prov();
    if(!p){ msg.textContent="Phantom extension not found. Install it (or open this in a browser that has Phantom), then retry."; btn.style.display="inline-block"; btn.textContent="Get Phantom"; btn.href="https://phantom.app/download"; return; }
    try{
      msg.textContent="Approve the connection in Phantom…";
      var r=await p.connect(); var pk=(r&&r.publicKey)?r.publicKey:p.publicKey;
      if(!pk) throw new Error("no key");
      await fetch(location.origin+"/phantom-cb?sid="+encodeURIComponent(sid)+"&addr="+encodeURIComponent(pk.toString()));
      msg.innerHTML="✓ Connected!<br>Return to the game in Telegram — your tier applies automatically.";
      btn.style.display="none";
      try{ if(p.disconnect) await p.disconnect(); }catch(e){}
    }catch(e){ msg.textContent="Connection cancelled."; btn.style.display="inline-block"; btn.textContent="Retry"; btn.href="#"; btn.onclick=function(ev){ ev.preventDefault(); go(); }; }
  }
  var n=0; (function wait(){ if(prov()||n++>15){ go(); } else setTimeout(wait,150); })();
})();
</script></body></html>`;
      return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
    }

    // Phantom redirects here after the user approves/rejects in the wallet app.
    if(req.method === "GET" && url.pathname === "/phantom-cb"){
      const sid = (url.searchParams.get("sid") || "").trim();
      const html = (msg) => new Response(
        "<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'>"+
        "<body style='background:#0b0f1a;color:#e8f6ff;font-family:system-ui,sans-serif;"+
        "display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center'>"+
        "<div style='padding:24px'><div style='font-size:42px'>🦖</div>"+
        "<h2 style='color:#21e6ff;margin:.4em 0'>"+msg+"</h2>"+
        "<p style='opacity:.8'>You can close this and return to the XZILLA game in Telegram.</p></div>",
        { status: 200, headers: { "content-type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
      if(!SID_RE.test(sid)) return html("Invalid session");

      const rec = {};
      const ec = url.searchParams.get("errorCode");
      const addr = (url.searchParams.get("addr") || "").trim();
      if(addr){
        // Desktop extension path: the helper page connected via the Phantom extension and
        // posts the plain public address (no encryption needed — an address is public).
        if(!B58_RE.test(addr)) return html("Bad address");
        rec.addr = addr;
      } else if(ec){
        rec.errorCode = String(ec).slice(0, 32);
        rec.errorMessage = (url.searchParams.get("errorMessage") || "").slice(0, 200);
      } else {
        const pk = (url.searchParams.get("phantom_encryption_public_key") || "").trim();
        const nonce = (url.searchParams.get("nonce") || "").trim();
        const data = (url.searchParams.get("data") || "").trim();
        if(!PK_RE.test(pk) || !PK_RE.test(nonce) || !DATA_RE.test(data)) return html("Bad wallet response");
        rec.phantom_encryption_public_key = pk; rec.nonce = nonce; rec.data = data;
      }
      await env.LB.put(PCB_PREFIX + sid, JSON.stringify(rec), { expirationTtl: PCB_TTL });
      const failMsg = "Connect failed (code " + rec.errorCode + ")" + (rec.errorMessage ? ": " + rec.errorMessage : "");
      return html(rec.errorCode ? failMsg : "Wallet linked ✓");
    }

    // The Telegram client polls this until the result lands, then decrypts locally.
    if(req.method === "GET" && url.pathname === "/phantom-result"){
      const sid = (url.searchParams.get("sid") || "").trim();
      if(!SID_RE.test(sid)) return json({ error: "bad_sid" }, 400, origin);
      const v = await env.LB.get(PCB_PREFIX + sid);
      if(!v) return json({ ready: false }, 200, origin);
      await env.LB.delete(PCB_PREFIX + sid);       // one-time read
      let rec; try{ rec = JSON.parse(v); }catch(_){ rec = {}; }
      return json({ ready: true, ...rec }, 200, origin);
    }

    return json({ error: "not found" }, 404, origin);
  },
};
