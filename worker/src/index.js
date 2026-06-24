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

function cors(origin){
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
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

    return json({ error: "not found" }, 404, origin);
  },
};
