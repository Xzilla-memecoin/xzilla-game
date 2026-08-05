---
name: xzilla-play
description: Play XZILLA well (or drive it with the autopilot) — entity semantics, combo/score math, projectile and boss mechanics, and the run-start gotcha that silently disables rug bosses. Use when playing, testing gameplay, tuning difficulty, or debugging why a run behaves oddly.
---

# Playing XZILLA

Everything here was read out of `index.html` / `game.js` and confirmed live in the browser.
Line references are for verification — check them before trusting anything, the files move.

## 1. Start a run the RIGHT way (this one bites)

**Always start with a click on `#startBtn` / `#retryBtn`. Never call `startGame()` directly.**

Four pre-run hooks are registered as *click listeners* on those buttons
(`game.js:1623`, `2912`, `3381`, `4492`). `startGame()` skips all of them, which costs:

- upgrades never applied, no head-start shield, no WARM ENGINE opening combo,
  no SECOND WIND revive, no NITRO LAUNCH ×2 (`set2BeforeRun`, `game.js:2902`)
- `rugPending` / `nextBossWave` / `lastBossEnd` never reset — and a stale `rugPending=true`
  makes the spawn gate at `game.js:2060` fail forever, so **no rug boss spawns again for the
  entire session**. Symptom: `window.__rugBossAt` stays `0` while the wave counter climbs.

`startDailyRun()` routes through `btn.click()` (`game.js:4291`) for exactly this reason.

## 2. What to grab and what to dodge

Semantics are inverted from what the names suggest — you *collect* scammers.
Resolution logic: `game.js:2632` (overrides the simpler `index.html:1303`).

| Type | id | Contact result |
|---|---|---|
| SCAMMER | 0 | **Catch.** +points ×combo, combo++ . Letting one pass **resets combo** (`index.html:1384`) |
| BOMB | 3 | **Catch.** Clears every scammer on field and each one *builds* combo |
| SHIELD | 2 | **Catch.** Absorbs one lethal hit |
| HEART | 11 | **Catch.** +1 life |
| PWR_SLOW / X2 / MAG / TRI / ROCKET | 8/9/10/12/13 | **Catch.** Buffs |
| HOLDER | 1 | **Avoid.** Costs a life (shield absorbs) |
| HONEYPOT | 5 | **Avoid.** Costs a life. Looks like a pickup |
| DECOY "fake airdrop" | 6 | **Avoid.** Combo reset |
| RUGBOSS / BOSS | 7 / 4 | **Never ram** — costs a life and the boss just bounces back undefeated |

Near-miss bonus: passing a HOLDER or HONEYPOT at a gap of 1.85–2.90 pays `+8 × tier × x2`
(`game.js:2087`). Only those two types qualify.

## 3. Thrown projectiles — the ones a naive bot never sees

`RED CANDLE` and `EMPTY PROMISE` sprites are **not in `active`**. They live in a
closure-local `THROWS.live` pool (`game.js:2506`), reachable only as `scene.children`
carrying `_lethal` / `_vx` / `_vz`. Cannon tracers also carry `_vx/_vz`, so key off
`_lethal !== undefined` to tell them apart.

- **RED CANDLE** — lethal, `vz = 22`, thrown by the boss only.
- **EMPTY PROMISE** — non-lethal buzzword bubble lobbed by ruggers, `vz = 17`.
  **Breaks your combo** (`game.js:2623`), which given §4 is expensive.
- Hit test: `|z − PLAYER_Z| < 1.35 && |x − player.x| < 1.35`, checked every frame in that band.
- Both are aimed at where you *are*, under-led (`lead` 0.8–0.85, `aimThrow` at `game.js:2559`).
  **Lateral motion dodges them; camping does not.** Standing still is the losing move.

## 4. Score math — combo is everything

`addScore` multiplies by the **live combo**: `m = (combo>1 ? combo : 1) × …` (`game.js:959`).
A scammer caught at combo 25 is worth 25×. So a broken streak does not cost "one pickup",
it costs the multiplier on everything after it. Rank the priorities accordingly:

1. Don't die (a life is still worth more than any streak).
2. Don't break combo — never eat a decoy or an empty promise, never let a scammer pass.
3. Then farm pickups.

Combo has **no wall-clock decay** — it breaks only on an actual whiff (`index.html:1385`).
Wave = `1 + floor(score/150)`.

## 5. Boss fights

- Ramming does nothing but hurt you. The **auto-cannon is the only way to kill it**
  (`damageBoss`, `game.js:2252`). Kill pays `+900 × tier × mults`.
- Only the cannon's **centre stream** damages the boss; it fires from `player.x` with an
  0.85 lock-on (`fireVolley`, `game.js:2233`). TRI-CANNON's side streams fan outward and
  sail past the boss — they're for off-centre traffic, not boss DPS.
- **The barrage ramps with fight duration**: `candleCap` 6→14 and the interval tightens
  1.5s→0.5s over the first 30s (`game.js:2589`), keyed to *real* time — so camping in
  SLOW-MO to farm does not slow the candles. A long fight is what kills you.
- First boss at wave 4, then 4 waves after each defeat, with `MIN_BOSS_GAP = 45s` between
  fights (`game.js:1917`, `1922`, `2284`).

## 6. Physics constants worth knowing

| Thing | Value | Where |
|---|---|---|
| Contact box | `catchX = 1.85`, `catchZ = 1.6` | `index.html:1374` |
| Near-miss band | 1.85 → 2.90 | `index.html:1374` |
| Steering ease | `x += (targetX − x) × 0.3` per frame | `index.html:1370` |
| Mouse sensitivity | `movementX × 0.022` world units | `index.html:1080` |
| Player depth | `PLAYER_Z = 8` | |
| Base speed | 14.4, ramps past 50 | `CFG.baseSpeed` |

Time for an entity to reach you: `t = (PLAYER_Z − z) / state.speed`.
Where the bike will be if you hold a target: `x(t) = target + (x0 − target) × 0.7^(60t)`.

## 7. The autopilot

`bot.js` in this directory. Load it into the page and:

```js
window.__bot.play()    // clicks the real start button, then steers  <- use this
window.__bot.stats()   // live readout
window.__bot.stop()
```

It steers by dispatching `mousemove` with `movementX`, so it drives the game's own desktop
input handler rather than bypassing it.

How it works: every frame it turns each entity and projectile into an *arrival event*
(`t`, `x`), samples ~90 candidate lane positions, predicts where the bike would actually be
at each arrival using the real lerp, scores the outcome, and steers toward the best.

Two mistakes worth not repeating, both found the hard way:

- **Check the swept window, not the arrival instant.** The bike moves ~2.6 units/frame; a
  single-point check says you'll clear a hazard while you actually sweep straight through it.
  Sample `t ± catchZ/speed`. Every early death was this.
- **Price a combo break properly** (`90 + combo×28`). Priced as one pickup, the planner
  happily eats an EMPTY PROMISE to grab one more scammer.

## 8. Running it locally

```bash
python -m http.server 8123 --bind 127.0.0.1     # from the repo root
# then http://127.0.0.1:8123/index.html
```

Add `?cb=N` when iterating — plain reloads serve a cached `index.html` and you will test
stale code. Two environment traps when driving from an agent:

- **Pointer lock needs the Chrome window to hold real OS focus.** Otherwise the request
  fails with `WrongDocumentError: The root document of this element is not valid for
  pointer lock`, no matter that `document.hasFocus()` reports `true`.
- **A minimised or fully-occluded window makes the tab `hidden`**, which freezes
  `requestAnimationFrame` and auto-pauses the run. Long unattended runs need the window
  raised and visible.

## 9. Known gaps in the bot

- **Long boss fights are the one thing that kills it.** Normal traffic is essentially solved
  — the 32,126 run took 0 candle hits and 1 promise hit through its first two boss fights
  (killed in 6.5s and 10s). It died when the third boss survived 68s and the fully-ramped
  barrage landed 11 candles. Anything that shortens a boss fight is worth more than any
  further dodging work; see the warning in §5 about how *not* to do it.
- No modelling of MAGNET pulling scammers toward the player, or of rocket/tri lifetimes.
- **Run-to-run variance dwarfs most tuning.** Same config, consecutive runs: 32,126 / 21,702 /
  29,140 / 16,740. Don't credit a tweak for a single good run — the sweep + centering pair
  below produced the longest survival (3:59) *and* one of the worst scores (16,740), because
  time alive and score rate trade against each other. Judge changes on a handful of runs.
- Two survival heuristics that are in and worth keeping, on reasoning rather than a
  measured win: the barrage **sweep** (§3 — hold one direction, candles land behind you)
  and a mild **centering** term (a wall halves your escape lanes; the bot's classic normal
  traffic death is being pinned against one by a cluster of HODLERs).

## 10. Scoreboard

| Score | Time | Config | Killed by |
|---|---|---|---|
| **32,126** | 2:51 | swept-window + combo pricing | boss #3, 68s fight, 11 candles |
| 29,140 | 3:59 | + sweep + centering | boss #4, ~48s fight |
| 21,702 | 2:34 | + boss-lane pull (guarded) | boss #3, 65s fight |
| 16,740 | 1:45 | + sweep + centering | boss #2, 45s fight |
| 3,408 | 0:46 | + sweep, no centering | pinned on the right wall by HODLERs |
| 2,122 | 0:49 | + boss-lane pull (unguarded) | rammed the boss |

Every single loss above ~15k was a boss fight. That is where the remaining work is.
