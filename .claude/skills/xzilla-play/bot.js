/* XZILLA autopilot — paste into the page console (or eval via CDP) during a run.
   Steers through the game's OWN mousemove handler, so it exercises the real desktop
   input path. Nothing here is loaded by the game; it is a play/QA tool only.

   window.__bot.start() / .stop()   —  window.__bot.stats() for a live readout. */
window.__bot && window.__bot.stop();
window.__bot = (function(){

  /* ---- constants lifted from the game (index.html main loop + game.js) ---- */
  const CATCH   = 1.85;                 // catchX: |dx| under this = contact
  const CATCH_Z = 1.6;                  // catchZ: half-depth of the contact band
  const R_THROW = 1.35;                 // thrown-projectile hit radius (x AND z)
  const LERP    = CFG.playerSpeedLerp;  // 0.3 per frame, the bike's x easing

  /* ---- what each entity type is worth ----
     SCAMMER is the score engine: addScore multiplies by the LIVE COMBO, so a caught
     scammer at combo 25 is worth 25x. Letting one sail past resets combo to 0, which
     is why misses are punished harder than catches are rewarded. */
  const PICKUP = {
    0: "scammer",   // TYPE.SCAMMER  — catch: +points, +combo
    2: 30,          // SHIELD        — eats one lethal hit
    3: 46,          // BOMB          — clears every scammer on field, each one BUILDS combo
    8: 20,          // PWR_SLOW      — slow-mo
    9: 34,          // PWR_X2        — double score
    10: 20,         // PWR_MAG       — scammer magnet
    11: 70,         // HEART         — +1 life
    12: 32,         // PWR_TRI       — tri-cannon
    13: 32          // PWR_ROCKET    — rocket launcher
  };
  const LETHAL = {1:1, 5:1, 4:1, 7:1};  // HOLDER, HONEYPOT, BOSS, RUGBOSS — cost a life
  const COMBO_KILLER = {6:1};           // DECOY (fake airdrop) — combo only

  const LIFE_COST = 1500;
  // addScore multiplies EVERY catch by the live combo, so breaking a streak of 20 does not
  // cost "one pickup" — it costs the 20x multiplier on everything that follows. Price it high
  // or the planner will happily eat an EMPTY PROMISE to grab one more scammer.
  const comboLoss = () => 90 + Math.min(state.combo, 40) * 28;
  const catchGain = () => 30 + Math.min(state.combo, 40) * 4;

  /* What a pickup is worth RIGHT NOW, given the boss forecast. */
  function pickupValue(type, ph, barrage){
    if(type === 2){                                  // SHIELD
      // shieldActive is a boolean — a second shield while one is up is worth NOTHING,
      // so never detour for it. Before a boss, an unheld shield is the single most
      // valuable thing on the field: it is one free candle.
      if(shieldActive) return 0;
      return (ph === "prep" || ph === "fight") ? 420 : 30;
    }
    if(type === 11) return (ph === "prep" || ph === "fight") ? 150 : 70;   // HEART
    // In a live barrage, ordinary loot is not worth crossing a candle lane for.
    const base = PICKUP[type] || 0;
    return (ph === "fight" && barrage) ? base * 0.35 : base;
  }

  /* How much a shield lets us discount a lethal hit. Normally a shield exists to be
     spent. Once a boss is close it does NOT — spending it on ordinary traffic is what
     leaves us bare for the barrage that actually kills us. */
  const shieldDiscount = ph =>
    !shieldActive ? 1 : (ph === "prep" || ph === "fight") ? 0.75 : 0.25;

  let on = false, sweepDir = 1, stats = {ticks:0, replans:0};

  /* ---- BOSS FORECAST -----------------------------------------------------
     Every loss above ~15k was a boss fight, and a fight is long BY DESIGN
     (px.rugMax = (3 + wave/4) * 8, game.js:2013) — so it cannot be shortened,
     only survived better. The one thing that IS bankable is the shield:
     `shieldActive` is a BOOLEAN, not a counter, so you can carry exactly one
     into the fight, and only if you stop spending it on ordinary traffic first.

     Scheduling (game.js:1917, 2058, 2284): first boss at wave 4, then four
     waves after each defeat, with MIN_BOSS_GAP = 45s between fights, where
     wave = 1 + floor(score/150). nextBossWave is closure-local, so mirror it
     from observed defeats. window.__rugWarn / __rugBossAt are globals the game
     does expose, but only 3s ahead — too late to go shopping for a shield. */
  const MIN_BOSS_GAP = 45, PREP_WAVES = 3;
  let nextBossWave = 4, lastBossEnd = 0, bossWasOnField = false;
  const secs = () => performance.now() / 1000;

  function phase(){
    const bossNow = active.some(e => !e.dead && (e.type === 7 || e.type === 4));
    if(bossWasOnField && !bossNow){                 // fight just ended
      lastBossEnd = secs();
      nextBossWave = (1 + Math.floor(state.score / 150)) + 4;
    }
    bossWasOnField = bossNow;
    if(bossNow) return "fight";
    if(window.__rugWarn) return "prep";             // the game's own 3s warning
    const gapReady = (secs() - lastBossEnd) >= MIN_BOSS_GAP - 8;
    if(gapReady && state.wave >= nextBossWave - PREP_WAVES) return "prep";
    return "normal";
  }

  /* where the bike is t seconds from now if we hold `target` (mirrors index.html:
     player.position.x += (playerTargetX - x) * CFG.playerSpeedLerp, once per frame) */
  const xAt = (x0, target, t) => target + (x0 - target) * Math.pow(1 - LERP, t * 60);

  /* Thrown projectiles (red candles + "EMPTY PROMISE" bubbles) live in a CLOSURE-LOCAL
     THROWS.live pool inside game.js — they are NOT in `active`, which is the single
     easiest thing to miss when writing a bot for this game. They are reachable only as
     scene children carrying _lethal/_vx/_vz. Cannon tracers also carry _vx/_vz, so key
     off _lethal being defined to tell them apart. */
  function throwsInFlight(){
    const out = [];
    for(const o of scene.children){
      if(!o.visible || o._lethal === undefined || o._vz === undefined) continue;
      const vz = Math.max(1, o._vz);
      const t = (PLAYER_Z - o.position.z) / vz;
      if(t < -0.2 || t > 2.5) continue;
      out.push({ t: Math.max(0, t), x0: o.position.x, vx: o._vx || 0,
                 w: R_THROW / vz,            // half the hit window in seconds
                 lethal: !!o._lethal });
    }
    return out;
  }

  function plan(){
    const hw = playHalfWidth, x0 = player.position.x, sp = Math.max(1, state.speed);
    const w = CATCH_Z / sp;                    // half the contact band, in seconds
    const ev = [];
    let bossX = null, bossT = 0;
    for(const e of active){
      if(e.dead) continue;
      const t = (PLAYER_Z - e.sprite.position.z) / sp;
      const isBoss = (e.type === 7 || e.type === 4);
      // The boss body gets a LONGER horizon than everything else. It loiters mid-field and
      // bounces back to spawn depth on contact, so at a normal 3s horizon it spends most of
      // the fight invisible to the planner — which is what made the old boss-lane pull lethal.
      if(t < -w - 0.05 || t > (isBoss ? 6.0 : 3.0)) continue;
      if(isBoss && bossX === null){ bossX = e.sprite.position.x; bossT = t; }
      ev.push({ t: Math.max(0, t), x: e.sprite.position.x, type: e.type });
    }
    const thr = throwsInFlight();
    if(!ev.length && !thr.length) return x0;


    // Thrown shots are aimed at where you ARE and UNDER-led (lead 0.8-0.85 in aimThrow), so
    // they land behind a mover and dead on a camper. The right answer is not per-frame
    // reaction, it is a STEADY SWEEP: hold one lateral direction and every candle thrown at
    // you arrives short. Reversing hands them the lead back, so only turn at the wall.
    const barrage = thr.some(p => p.lethal);
    if(barrage){
      if(x0 >  hw - 2.5) sweepDir = -1;
      else if(x0 < -hw + 2.5) sweepDir = 1;
    }

    const ph = phase();
    const shDisc = shieldDiscount(ph);

    let best = x0, bestScore = -1e9;
    for(let target = -hw; target <= hw; target += 0.2){
      let sc = barrage ? Math.max(0, Math.min((target - x0) * sweepDir, 4)) * 3.0
                       : -Math.abs(target - x0) * 0.15;     // don't thrash for nothing

      // KEEP ESCAPE ROUTES. Hugging a wall halves the lanes you can flee into, and the way
      // this bot dies in normal traffic is being pinned against one by a cluster of HODLERs
      // arriving within a second of each other. Mild, so it never overrides a real pickup.
      sc -= Math.abs(target) * 0.35;

      for(const e of ev){
        // sample the WHOLE crossing window, not just the arrival instant — the bike is
        // moving ~2.6 units/frame and will otherwise sweep straight through a hazard
        // that the single-point check said it would clear.
        let gap = 1e9;
        for(let k = -1; k <= 1; k++){
          const tt = Math.max(0, e.t + k * w);
          const g = Math.abs(Math.max(-hw, Math.min(hw, xAt(x0, target, tt))) - e.x);
          if(g < gap) gap = g;
        }
        const soon = 1 / (1 + e.t * 0.8);
        if(LETHAL[e.type]){
          if(gap < CATCH + 0.75) sc -= LIFE_COST * soon * shDisc;
        } else if(COMBO_KILLER[e.type]){
          if(gap < CATCH + 0.5) sc -= comboLoss() * soon;
        } else if(e.type === 0){                            // SCAMMER: catch it or lose the streak
          const greed = (ph === "fight" && barrage) ? 0.4 : 1;
          if(gap < CATCH - 0.35) sc += catchGain() * soon * greed;
          else sc -= comboLoss() * soon * 0.55 * greed;
        } else {
          const v = pickupValue(e.type, ph, barrage);
          if(v > 0){
            if(gap < CATCH - 0.35) sc += v * soon;
            else sc -= Math.min(6, gap) * (v > 100 ? 4.5 : 0.7) * soon;   // hunt shields/hearts harder
          }
        }
      }

      for(const p of thr){
        // the projectile keeps drifting sideways (_vx) the whole way in, and its hit test runs
        // every frame it is inside |z - PLAYER_Z| < 1.35 — so check the swept window, both for
        // where WE will be and where IT will be, not a single instant.
        let gap = 1e9;
        for(let k = -1; k <= 1; k++){
          const tt = Math.max(0, p.t + k * p.w);
          const me = Math.max(-hw, Math.min(hw, xAt(x0, target, tt)));
          const g = Math.abs(me - (p.x0 + p.vx * tt));
          if(g < gap) gap = g;
        }
        if(gap < R_THROW + 0.7){
          const soon = 1 / (1 + p.t * 0.8);
          sc -= (p.lethal ? LIFE_COST * shDisc : comboLoss()) * soon;
        }
      }

      // NO BOSS-LANE PULL. Tried twice. Boss HP is (3 + wave/4) * 8 (game.js:2013), so a late
      // fight is long BY DESIGN and tightening the cannon's lead does not shorten it —
      // measured 65.5s with the pull vs 68.5s without, while the unguarded version scored
      // 2,122 by steering into the boss body. Survive the barrage instead.

      if(sc > bestScore){ bestScore = sc; best = target; }
    }
    return best;
  }

  function tick(){
    if(!on) return;
    requestAnimationFrame(tick);
    if(!state.running) return;
    stats.ticks++;
    // did we actually walk into the fight carrying a shield?
    const ph = phase();
    if(ph === "fight" && !stats._inFight){ stats._inFight = true;
      stats.fights = (stats.fights||0) + 1;
      if(shieldActive) stats.fightsShielded = (stats.fightsShielded||0) + 1;
    } else if(ph !== "fight") stats._inFight = false;
    const dx = plan() - state.playerTargetX;
    if(Math.abs(dx) > 0.02){
      stats.replans++;
      // MOUSE_SENSITIVITY is 0.022 world units per movementX — drive the real handler
      window.dispatchEvent(new MouseEvent("mousemove", {
        movementX: Math.max(-120, Math.min(120, dx / 0.022)), bubbles: true
      }));
    }
  }

  return {
    /* ALWAYS start a run this way, never with startGame().
       Four pre-run hooks are registered as CLICK LISTENERS on #startBtn/#retryBtn
       (resetRun, set2BeforeRun, the ad refresh, and the daily-run hook). Calling
       startGame() directly skips all of them, which means: no upgrades applied, no
       head-start shield, no WARM ENGINE combo, no SECOND WIND revive, no NITRO x2 —
       and, worst of all, rugPending/nextBossWave/lastBossEnd are never reset, so a
       stale rugPending=true silently blocks EVERY rug boss for the rest of the
       session (game.js:2060 gates on !rugPending). game.js:4291 routes the daily
       run through btn.click() for exactly this reason. */
    play(){
      const b = document.getElementById(state.running ? "retryBtn" : "startBtn")
             || document.getElementById("startBtn");
      if(!b) throw new Error("start button not found");
      b.click();
      this.start();
    },
    start(){ if(!on){ on = true; requestAnimationFrame(tick); } },
    stop(){ on = false; },
    get on(){ return on; },
    stats(){ return { t:+state.elapsed.toFixed(0), score:Math.floor(state.score), kills:state.kills,
                      combo:state.combo, lives:state.lives, speed:+state.speed.toFixed(1),
                      running:state.running, phase:phase(), shield:!!shieldActive,
                      nextBossWave, wave:state.wave, ...stats }; }
  };
})();
