/* ============================================================================
   XZILLA — cross-player leaderboard (Cloudflare Worker + KV)

   Endpoints
     GET  /top      -> { top: [{ name, score }, ...] }   (top 10, public)
     POST /submit   -> { ok, rank, top }                 body: { initData, score }

   Security
     /submit verifies the Telegram WebApp `initData` HMAC with your BOT_TOKEN, so the
     player's identity (Telegram user id + name) is trusted and can't be spoofed.
     NB: the *score value* is still client-reported — fine for a casual board; add
     server-side validation later if cheating becomes a problem.

   Storage
     A single KV key holds the sorted board (top MAX_KEEP). Simple + cheap; for very
     high write concurrency migrate to a Durable Object.
   ========================================================================== */

const TOP_KEY   = "lb:v1";
const MAX_KEEP  = 200;
const MAX_SCORE = 50000;   // sanity ceiling — a higher score on launch day means an exploit script → reject
const RATE_MS   = 30000;   // minimum ms between accepted submits per user → blocks rapid API spam

// $XZILLA SPL mint — the token whose balance sets a player's holder tier/multiplier.
// Overridable via env.XZILLA_MINT if the mint ever changes.
const XZILLA_MINT = "2VzDVUgzTHSf9qCPdkYBeMd2sK7m8t9GR2MN5kxRpump";
const B58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;   // base58 Solana address shape

const ADS_KEY = "ads:v1";     // KV key holding the live billboard ad config
const ADS_MAX_BYTES = 8000;   // reject oversized ad payloads

const IMG_PREFIX = "img:";                 // KV key prefix for uploaded ad images
const IMG_MAX_BYTES = 2_000_000;           // 2 MB cap per ad image
const IMG_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

function cors(origin){
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, x-admin-token",
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

export default {
  async fetch(req, env){
    const origin = req.headers.get("Origin") || "*";
    if(req.method === "OPTIONS") return new Response(null, { headers: cors(origin) });
    const url = new URL(req.url);

    if(req.method === "GET" && url.pathname === "/top"){
      const list = JSON.parse((await env.LB.get(TOP_KEY)) || "[]");
      return json({ top: list.slice(0, 10).map(e => ({ name: e.name, score: e.score })) }, 200, origin);
    }

    if(req.method === "POST" && url.pathname === "/submit"){
      let body;
      try{ body = await req.json(); }catch(_){ return json({ error: "bad json" }, 400, origin); }
      const score = Math.max(0, Math.round(Number(body.score) || 0));
      const user = await verifyInitData(body.initData || "", env.BOT_TOKEN);
      if(!user) return json({ error: "unauthorized" }, 401, origin);
      const id   = String(user.id);
      const name = (user.username ? "@" + user.username : (user.first_name || "Player")).slice(0, 24);

      // (1) SANITY CAP — reject impossible scores instead of recording them.
      if(score > MAX_SCORE) return json({ error: "score_rejected" }, 400, origin);

      // (2) RATE LIMIT — one accepted submit per user per RATE_MS (per-user timestamp in KV).
      const tsKey = "ts:" + id;
      const last  = parseInt((await env.LB.get(tsKey)) || "0", 10);
      const now   = Date.now();
      if(last && (now - last) < RATE_MS) return json({ error: "rate_limited" }, 429, origin);
      await env.LB.put(tsKey, String(now));

      const list = JSON.parse((await env.LB.get(TOP_KEY)) || "[]");
      const idx  = list.findIndex(e => e.id === id);
      let changed = false;
      if(idx >= 0){ if(score > list[idx].score){ list[idx].score = score; list[idx].name = name; changed = true; } }
      else { list.push({ id, name, score }); changed = true; }
      list.sort((a, b) => b.score - a.score);
      const trimmed = list.slice(0, MAX_KEEP);
      if(changed) await env.LB.put(TOP_KEY, JSON.stringify(trimmed));   // only write the board when it actually changes
      const rank = trimmed.findIndex(e => e.id === id) + 1;
      return json({ ok: true, rank, top: trimmed.slice(0, 10).map(e => ({ name: e.name, score: e.score })) }, 200, origin);
    }

    // -------- GET /ads  (public, no-store) ---------------------------------------
    // Live ad config for the in-game billboards. Served from KV with no caching so an
    // update via POST /ads is visible to players within seconds (vs. ~5 min on the
    // GitHub-raw CDN). Shape: { messages: [ "TEXT" | {text,color,imageUrl,clickLink} ] }.
    if(req.method === "GET" && url.pathname === "/ads"){
      const v = await env.LB.get(ADS_KEY);
      return new Response(v || '{"messages":[]}', {
        status: 200,
        headers: { "content-type": "application/json", "Cache-Control": "no-store", ...cors(origin) },
      });
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
      const arr = Array.isArray(parsed) ? parsed
                : (parsed && Array.isArray(parsed.messages) ? parsed.messages : null);
      if(!arr) return json({ error: "expected an array or {messages:[...]}" }, 400, origin);
      await env.LB.put(ADS_KEY, JSON.stringify({ messages: arr }));
      return json({ ok: true, count: arr.length }, 200, origin);
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

    return json({ error: "not found" }, 404, origin);
  },
};
