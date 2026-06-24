# XZILLA Leaderboard Worker (Cloudflare + KV)

A tiny free backend that stores a cross-player top-10 for the game.

- `GET  /top`     → `{ top: [{ name, score }] }` (top 10, public)
- `POST /submit`  → body `{ initData, score }` — verifies the Telegram WebApp
  `initData` HMAC with your bot token, then keeps each user's best score.

The game (`index.html` / `game.js`) calls these automatically once you set
`LEADERBOARD_API` in `index.html` to your deployed Worker URL.

## One-time deploy (free)

Prereqs: a free [Cloudflare](https://dash.cloudflare.com/sign-up) account and Node.

```bash
cd worker
npm i -g wrangler        # or use: npx wrangler ...
wrangler login

# 1) create the KV namespace and copy the printed id into wrangler.toml
wrangler kv namespace create LB

# 2) store your @BotFather bot token as a secret (used to verify players)
wrangler secret put BOT_TOKEN

# 3) deploy
wrangler deploy
```

`wrangler deploy` prints a URL like:

```
https://xzilla-leaderboard.<your-subdomain>.workers.dev
```

Paste that into `index.html`:

```js
const LEADERBOARD_API = "https://xzilla-leaderboard.<your-subdomain>.workers.dev";
```

Commit + bump the `?v=` cache string, and the RANKS tab will show **TOP 10 DEGENS**.

## Notes
- Identity is verified (real Telegram user), but the **score value is client-reported**.
  Good enough for a casual board; add server-side validation later if needed.
- Storage is a single KV key (simple + cheap). For very high concurrent writes,
  migrate to a Durable Object to avoid rare last-write-wins clobbers.
- Free tier limits (Workers 100k req/day, KV 1k writes/day) are ample for launch.
