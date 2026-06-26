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
const ADS_MAX_BYTES = 24000;  // reject oversized ad payloads (3 ratio groups + image URLs)
const AD_GROUP_KEYS = ["wide", "square", "tall"];   // the 3 aspect-ratio pools

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

    // ===================== Per-user economy (cross-device XP/upgrades) ===========
    // Saved server-side keyed to the verified Telegram user (same trust model as /submit:
    // identity is verified, the values are client-reported). Makes XP/upgrades reliable
    // across devices instead of depending on per-device localStorage / flaky CloudStorage.
    const ECON_PREFIX = "econ:";
    const ECON_MAX_BYTES = 8000;

    if(req.method === "POST" && url.pathname === "/econ-load"){
      let body; try{ body = await req.json(); }catch(_){ return json({ error: "bad json" }, 400, origin); }
      const user = await verifyInitData(body.initData || "", env.BOT_TOKEN);
      if(!user) return json({ error: "unauthorized" }, 401, origin);
      const v = await env.LB.get(ECON_PREFIX + user.id);
      let snap = null; try{ snap = v ? JSON.parse(v) : null; }catch(_){ snap = null; }
      return json({ ok: true, snap }, 200, origin);
    }

    if(req.method === "POST" && url.pathname === "/econ-save"){
      let body; try{ body = await req.json(); }catch(_){ return json({ error: "bad json" }, 400, origin); }
      const user = await verifyInitData(body.initData || "", env.BOT_TOKEN);
      if(!user) return json({ error: "unauthorized" }, 401, origin);
      const snap = body.snap;
      if(!snap || typeof snap !== "object" || Array.isArray(snap)) return json({ error: "bad_snap" }, 400, origin);
      const s = JSON.stringify(snap);
      if(s.length > ECON_MAX_BYTES) return json({ error: "too_large" }, 413, origin);
      await env.LB.put(ECON_PREFIX + String(user.id), s);
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
      const user = await verifyInitData(body.initData || "", env.BOT_TOKEN);
      if(!user) return json({ error: "unauthorized" }, 401, origin);
      const invitee = String(user.id);
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
      const user = await verifyInitData(body.initData || "", env.BOT_TOKEN);
      if(!user) return json({ error: "unauthorized" }, 401, origin);
      const id = String(user.id);
      const reward = parseInt(await env.LB.get(REFPEND_PREFIX + id), 10) || 0;
      const count  = parseInt(await env.LB.get(REFCOUNT_PREFIX + id), 10) || 0;
      if(reward > 0) await env.LB.delete(REFPEND_PREFIX + id);   // one-time claim
      // stamp the inviter's real name onto the board now that they've authenticated
      if(count > 0){
        const name = (user.username ? "@" + user.username : (user.first_name || "Player")).slice(0, 24);
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
