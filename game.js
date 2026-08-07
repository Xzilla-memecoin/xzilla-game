/* ============================================================================
   XZILLA — ENHANCEMENT LAYER
   Bloom + real floor + skyline + pylons + better art + boss + meta-systems.
   Runs after the base game script; overrides spawn/resolve/addScore/gameOver
   (all called internally by name) and augments the world & UI.
   ========================================================================== */

/* === ANCHOR: ADS_PAYLOAD === */
/* Base64 snapshot of the local (gitignored) ads-config.json. This string is the
 * payload that actually ships; regenerate it after editing ads-config.json with:
 *   node -e "console.log(Buffer.from(require('fs').readFileSync('ads-config.json')).toString('base64'))"
 * Decoded + JSON-parsed at runtime by decodeAdsPayload() in the ad-screen system.
 * NOTE: Base64 is encoding, not encryption — trivially decodable in any console. */
window._adsPayload = "WwogIHsKICAgICJpZCI6ICJ4emlsbGEtaG9tZSIsCiAgICAidGV4dCI6ICIkWFpJTExBIMK3IEJVWSBOT1ciLAogICAgImltYWdlVXJsIjogImh0dHBzOi8vcmF3LmdpdGh1YnVzZXJjb250ZW50LmNvbS9YemlsbGEtbWVtZWNvaW4veHppbGxhLWdhbWUvbWFpbi9pbWFnZXMvcnVnX2Jvc3Mud2VicCIsCiAgICAiY2xpY2tMaW5rIjogImh0dHBzOi8veHppbGxhLmlvIgogIH0sCiAgewogICAgImlkIjogImhvZGwtd2FnbWkiLAogICAgInRleHQiOiAiSE9ETCDCtyBXQUdNSSIsCiAgICAiaW1hZ2VVcmwiOiAiaHR0cHM6Ly9yYXcuZ2l0aHVidXNlcmNvbnRlbnQuY29tL1h6aWxsYS1tZW1lY29pbi94emlsbGEtZ2FtZS9tYWluL2ltYWdlcy9ob2RsZXIud2VicCIsCiAgICAiY2xpY2tMaW5rIjogImh0dHBzOi8vdC5tZS94emlsbGEiCiAgfSwKICB7CiAgICAiaWQiOiAidG8tdGhlLW1vb24iLAogICAgInRleHQiOiAiVE8gVEhFIE1PT04iLAogICAgImltYWdlVXJsIjogImh0dHBzOi8vcmF3LmdpdGh1YnVzZXJjb250ZW50LmNvbS9YemlsbGEtbWVtZWNvaW4veHppbGxhLWdhbWUvbWFpbi9pbWFnZXMvbWFpbkltYWdlLndlYnAiLAogICAgImNsaWNrTGluayI6ICJodHRwczovL2RleHNjcmVlbmVyLmNvbSIKICB9Cl0K";

/* ============================================================================
   ENGINE AUDIO — procedural HEAVY CHOPPER (ported from moter.html "heavy" preset).
   OVERRIDES the engine hooks index.html calls (startGame -> startEngine, the loop
   -> setEnginePitch, gameOver/quit -> stopEngine) so there's exactly ONE engine
   voice. It's DYNAMIC: throttle/RPM track state.speed, so the engine screams during the
   full-speed RUG BOSS chase and settles as you slow. Own AudioContext; honors mute via
   state.soundOn.
   ========================================================================== */
(function engineAudio(){
  const ENGINE_AUDIO = "on";   // "off" => no-op the hooks (full silence, no synth)
  if(ENGINE_AUDIO !== "on"){ window.startEngine=function(){}; window.stopEngine=function(){}; window.setEnginePitch=function(){}; return; }

  const BASE_VOL = 0.10;   // master level — kept well under the pickup/power SFX (tune here)
  const P = { idle:620, max:3200, boom:0.95, noise:0.015, crack:0.018, muffle:430, res:120 }; // "Heavy Chopper"
  // speed -> throttle: boss-slow reads near idle, cruising mid, top speed full throttle.
  const MIN_S = 4, MAX_S = 24;

  let ctx=null, master=null, running=false, timer=null;
  let rpm=P.idle, lastPulse=0, pulseSide=false;

  const throttleFromSpeed = () => {
    const s = (typeof state!=="undefined" && state.speed) ? state.speed : MIN_S;
    return Math.max(0, Math.min(1, (s - MIN_S) / (MAX_S - MIN_S)));
  };

  // One uneven V-twin "boom" — two oscillators + optional exhaust crackle. Transient
  // nodes are local (not retained) so they GC once they stop; only master/ctx persist.
  function pulse(time){
    const pan = ctx.createStereoPanner();
    pan.pan.value = pulseSide ? -0.12 : 0.12; pulseSide = !pulseSide;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, time);
    out.gain.exponentialRampToValueAtTime(0.9*P.boom, time+0.006);
    out.gain.exponentialRampToValueAtTime(0.0001, time+0.115);
    const low = ctx.createOscillator(); low.type="sine";
    low.frequency.setValueAtTime(P.res, time);
    low.frequency.exponentialRampToValueAtTime(42, time+0.12);
    const mid = ctx.createOscillator(); mid.type="triangle";
    mid.frequency.setValueAtTime(P.res*2.1, time);
    mid.frequency.exponentialRampToValueAtTime(75, time+0.08);
    const filter = ctx.createBiquadFilter(); filter.type="lowpass";
    filter.frequency.value=P.muffle; filter.Q.value=0.9;
    low.connect(out); mid.connect(out);
    out.connect(filter).connect(pan).connect(master);
    low.start(time); mid.start(time); low.stop(time+0.13); mid.stop(time+0.10);
    if(Math.random()<P.crack) crackle(time);
  }
  function crackle(time){
    const len=Math.floor(ctx.sampleRate*0.035), buf=ctx.createBuffer(1,len,ctx.sampleRate), d=buf.getChannelData(0);
    for(let i=0;i<len;i++) d[i]=(Math.random()*2-1)*(1-i/len);
    const src=ctx.createBufferSource(); src.buffer=buf;
    const hp=ctx.createBiquadFilter(); hp.type="highpass"; hp.frequency.value=220;
    const lp=ctx.createBiquadFilter(); lp.type="lowpass"; lp.frequency.value=P.muffle*1.4;
    const g=ctx.createGain(); g.gain.value=0.11;
    src.connect(hp).connect(lp).connect(g).connect(master);
    src.start(time); src.stop(time+0.04);
  }
  function intake(time, throttle){
    if(throttle<0.05) return;
    const len=Math.floor(ctx.sampleRate*0.055), buf=ctx.createBuffer(1,len,ctx.sampleRate), d=buf.getChannelData(0);
    for(let i=0;i<len;i++) d[i]=(Math.random()*2-1)*(1-i/len);
    const src=ctx.createBufferSource(); src.buffer=buf;
    const bp=ctx.createBiquadFilter(); bp.type="bandpass";
    bp.frequency.value=180+throttle*900; bp.Q.value=1.2;
    const g=ctx.createGain(); g.gain.value=P.noise*throttle;
    src.connect(bp).connect(g).connect(master);
    src.start(time); src.stop(time+0.06);
  }
  // Runs on a fixed 12ms timer (independent of frame rate). Reads state.speed directly,
  // eases RPM toward it, and schedules the uneven twin pattern. Goes silent + stops
  // scheduling over menu/pause/gameover and when the sound toggle is off.
  function step(){
    if(!ctx || !running) return;
    const driving = (typeof state!=="undefined" && state.running);
    const vol = (driving && state.soundOn!==false) ? BASE_VOL : 0;
    try{ master.gain.setTargetAtTime(vol, ctx.currentTime, 0.05); }catch(_){}
    if(!driving) return;                                       // freeze pulses over menu/pause/over
    const throttle = throttleFromSpeed();
    const targetRpm = P.idle + (P.max - P.idle)*throttle;
    rpm += (targetRpm - rpm)*0.035;
    rpm += (Math.random()-0.5)*18;
    const secondsPerRev = 60/Math.max(400, rpm);
    const gap = (pulseSide ? secondsPerRev*0.42 : secondsPerRev*1.18);   // two close pulses, then a longer gap
    if(ctx.currentTime - lastPulse > gap){
      lastPulse = ctx.currentTime;
      pulse(ctx.currentTime);
      intake(ctx.currentTime, throttle);
    }
  }

  // Run start = a real user gesture (the START tap), which clears the autoplay guard.
  window.startEngine = function(){
    try{
      if(!ctx){
        ctx = new (window.AudioContext||window.webkitAudioContext)();
        master = ctx.createGain(); master.gain.value=0;
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value=-22; comp.knee.value=20; comp.ratio.value=5;
        comp.attack.value=0.003; comp.release.value=0.16;
        master.connect(comp).connect(ctx.destination);
      }
      if(ctx.state==="suspended") ctx.resume().catch(()=>{});
      rpm=P.idle; lastPulse=ctx.currentTime; running=true;
      if(!timer) timer=setInterval(step, 12);
    }catch(_){}
  };
  // Crash / quit to menu: stop scheduling and fade the master out so nothing roars over the scoreboard.
  window.stopEngine = function(){
    running=false;
    try{ if(timer){ clearInterval(timer); timer=null; } }catch(_){}
    try{ if(master && ctx) master.gain.setTargetAtTime(0, ctx.currentTime, 0.08); }catch(_){}
  };
  // Loop calls this every frame; speed is read directly inside step(), so this is a no-op.
  window.setEnginePitch = function(){};
})();

(function(){
  if (typeof THREE === "undefined") { return; }
  const TEAL="#39ff7a", MAG="#ff2bd6", CYAN="#21e6ff", GOLD="#ffd23f", RED="#ff3b5c";

  /* === ANCHOR: ECONOMY === */
  /* ----------------------------- persistence ------------------------------ */
  const store = {
    get(k,d){ try{ const v=localStorage.getItem(k); return v==null?d:JSON.parse(v); }catch(e){ return d; } },
    set(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); }catch(e){} }
  };

  /* --------------------------- seeded RNG (daily run) ----------------------
   * Gameplay randomness routes through RND() instead of Math.random() so the DAILY
   * RUG RUN can hand every player on Earth the exact same scam sequence. Outside a
   * daily run window.__rng is null and RND() is just Math.random(), so normal play
   * is byte-for-byte unchanged.
   *
   * IMPORTANT: only *gameplay* decisions (what spawns, where, when) use RND —
   * particles, camera shake and city geometry deliberately stay on Math.random.
   * If cosmetic effects drew from the same stream, a device that skipped one
   * particle burst would desync the whole run and the seed would mean nothing.
   *
   * Note this makes the SEQUENCE deterministic, not a frame-perfect replay: a 30fps
   * phone and a 120fps desktop see the same enemies in the same order, with slightly
   * different sub-frame timing. That's the fairness bar we're aiming for. */
  function mulberry32(a){
    return function(){
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // 32-bit FNV-1a — turns a day string into a seed every client agrees on.
  function hashSeed(str){
    let h = 0x811c9dc5;
    for(let i=0;i<str.length;i++){ h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  }
  window.__rng = null;
  const RND = () => (window.__rng ? window.__rng() : Math.random());
  window.__RND = RND;   // index.html's spawn-timer jitter draws from the same stream
  const econ = {
    tokens:   store.get("xz_tokens", 2500),
    holdings: store.get("xz_holdings", 0),
    skins:    store.get("xz_skins", ["default"]),
    skin:     store.get("xz_skin", "default"),
    streak:   store.get("xz_streak", 0),
    streakDay:store.get("xz_streakDay", null)
  };
  function saveEcon(){
    store.set("xz_tokens",econ.tokens); store.set("xz_holdings",econ.holdings);
    store.set("xz_skins",econ.skins);   store.set("xz_skin",econ.skin);
    store.set("xz_streak",econ.streak); store.set("xz_streakDay",econ.streakDay);
    const ts=Date.now(); store.set("xz_econ_ts", ts);   // stamp locally (newest-wins across devices)
    cloudBackupEcon(ts);    // Telegram CloudStorage (legacy fallback)
    serverBackupEcon(ts);   // Worker, keyed to the Telegram user (reliable cross-device)
  }

  /* ---- cross-device economy backup --------------------------------------------
   * XP/upgrades/skins are saved SERVER-SIDE on the Worker keyed to the verified
   * Telegram user (like the leaderboard) so they follow the player across devices,
   * not just per-device localStorage. Telegram CloudStorage is kept as a secondary
   * fallback (and migrates existing players' progress into the server on first save).
   * On boot we read both, keep the newest, and never overwrite a backup before we've
   * read it (anti-clobber). Outside Telegram it's local-only. */
  const ECON_CLOUD_KEY = "xz_econ_v1";
  const hasCloud = () => (typeof tg!=="undefined" && tg && tg.CloudStorage && tg.CloudStorage.setItem);
  const econApi = () => (window.__LB_API||"").replace(/\/+$/,"");
  const tgInit  = () => (typeof tg!=="undefined" && tg && tg.initData) || "";
  function econSnapshot(ts){
    return { v:1, ts:ts,
      tokens:econ.tokens, holdings:econ.holdings, skins:econ.skins, skin:econ.skin,
      streak:econ.streak, streakDay:econ.streakDay, upg:store.get("xz_upg",{}),
      missions:store.get("xz_missions",null), daily:store.get("xz_daily",null),
      weekly:store.get("xz_weekly",null) };
  }
  let _cloudSaveT=null, _servSaveT=null;
  // Gate WRITES until we've READ the backups, so a slow/failed read can't let the game
  // boot with empty data and then clobber the real backup → permanent XP/upgrade loss.
  let _cloudReady=false;
  function cloudBackupEcon(ts){
    if(!hasCloud() || !_cloudReady) return;
    clearTimeout(_cloudSaveT);
    _cloudSaveT=setTimeout(()=>{ try{
      tg.CloudStorage.setItem(ECON_CLOUD_KEY, JSON.stringify(econSnapshot(ts)), function(){});
    }catch(_){} }, 500);
  }
  function serverBackupEcon(ts){
    if(!_cloudReady) return;
    const api=econApi(), init=tgInit(); if(!api||!init) return;
    clearTimeout(_servSaveT);
    _servSaveT=setTimeout(()=>{ try{
      fetch(api+"/econ-save",{ method:"POST", headers:{"content-type":"application/json"},
        body:JSON.stringify({ initData:init, snap:econSnapshot(ts) }) }).catch(()=>{});
    }catch(_){} }, 600);
  }
  function _applyCloudSnap(snap){
    if(typeof snap.tokens==="number")   econ.tokens=snap.tokens;
    if(typeof snap.holdings==="number") econ.holdings=snap.holdings;
    if(Array.isArray(snap.skins))       econ.skins=snap.skins;
    if(typeof snap.skin==="string")     econ.skin=snap.skin;
    if(typeof snap.streak==="number")   econ.streak=snap.streak;
    if(snap.streakDay)                  econ.streakDay=snap.streakDay;
    if(snap.upg) store.set("xz_upg", snap.upg);
    if(Array.isArray(snap.missions)){ store.set("xz_missions", snap.missions); missions=snap.missions; }
    if(snap.daily){  store.set("xz_daily",  snap.daily);  daily=snap.daily; }
    if(snap.weekly){ store.set("xz_weekly", snap.weekly); weekly=snap.weekly; }
    store.set("xz_tokens",econ.tokens); store.set("xz_holdings",econ.holdings);
    store.set("xz_skins",econ.skins);   store.set("xz_skin",econ.skin);
    store.set("xz_streak",econ.streak); store.set("xz_streakDay",econ.streakDay);
    store.set("xz_econ_ts", snap.ts);
  }
  function _refreshEconUI(){ try{
    if(typeof applyUpgrades==="function") applyUpgrades();
    if(typeof updateHUDtokens==="function") updateHUDtokens();
    if(typeof updateVip==="function") updateVip();
    if(typeof renderLives==="function") renderLives();
    if(typeof applySkin==="function") applySkin();
  }catch(_){ } }
  function serverLoadEcon(cb){
    const api=econApi(), init=tgInit(); if(!api||!init){ cb(null); return; }
    let done=false; const fin=s=>{ if(!done){ done=true; cb(s); } };
    setTimeout(()=>fin(null), 4000);
    try{ fetch(api+"/econ-load",{ method:"POST", headers:{"content-type":"application/json"},
      body:JSON.stringify({ initData:init }) }).then(r=>r.json())
      .then(d=>fin(d&&d.ok?d.snap:null)).catch(()=>fin(null)); }catch(_){ fin(null); }
  }
  function cloudLoadSnap(cb){
    if(!(hasCloud() && tg.CloudStorage.getItem)){ cb(null); return; }
    let done=false; const fin=s=>{ if(!done){ done=true; cb(s); } };
    setTimeout(()=>fin(null), 4000);
    try{ tg.CloudStorage.getItem(ECON_CLOUD_KEY, function(err,value){
      let s=null; try{ s=(!err&&value)?JSON.parse(value):null; }catch(_){}
      fin(s);
    }); }catch(_){ fin(null); }
  }
  // Boot loader: read server + cloud, apply whichever snapshot is newest than local.
  function restoreEcon(done){
    const servOK  = !!(econApi() && tgInit());
    const cloudOK = !!(hasCloud() && tg.CloudStorage.getItem);
    if(!servOK && !cloudOK){ _cloudReady=true; done(); return; }   // browser: local only
    const localTs = parseInt(store.get("xz_econ_ts",0),10)||0;     // capture BEFORE boot/migrate can bump it
    let booted=false; const finish=()=>{ if(!booted){ booted=true; done(); } };
    const to=setTimeout(finish, 2800);   // boot the UI even if a source is slow
    let best=null, pending=0;
    const consider=s=>{ if(s && typeof s.ts==="number" && (!best||s.ts>best.ts)) best=s; };
    const settle=()=>{ if(--pending>0) return;
      if(best && best.ts>localTs){ _applyCloudSnap(best); if(booted) _refreshEconUI(); }
      _cloudReady=true; clearTimeout(to); finish();
    };
    if(servOK){  pending++; serverLoadEcon(s=>{ consider(s); settle(); }); }
    if(cloudOK){ pending++; cloudLoadSnap(s=>{ consider(s); settle(); }); }
    if(!pending){ _cloudReady=true; finish(); }
  }
  const fmt = n => Math.round(n).toLocaleString("en-US");
  const abbr = n => n>=1e6 ? (n/1e6).toFixed(n%1e6?1:0)+"M" : n>=1e3 ? (n/1e3).toFixed(0)+"K" : ""+n;

  /* ---- double-sided referrals (XP only) -------------------------------------
   * Each player shares t.me/<bot>?startapp=<their-id>. A new player who opens that
   * link gets a welcome XP bonus and credits the inviter's pending bucket; the inviter
   * collects it on their next launch. Run only AFTER the economy has loaded so the XP
   * grant isn't wiped by a late cloud/server restore. */
  function refLink(){
    const id = (typeof tg!=="undefined" && tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.id);
    // Telegram players keep the t.me/?startapp= form — that is the ONLY link whose id
    // survives into tg.initDataUnsafe.start_param, i.e. the only one that credits a
    // referral. Everyone else gets the website.
    return id ? ("https://t.me/RugSmasher_bot/play?startapp="+id) : (window.__BOT_SHARE_URL || "https://xzilla.io/play/");
  }
  // Shared invite action — used by the main-screen button AND the RANKS panel button.
  function inviteFriends(){
    const link = refLink();
    const txt  = "🦖 Play XZILLA: RUG SMASHER with me — smash scammers, climb the board. We BOTH get XP when you join 👇";
    try{
      if(typeof tg!=="undefined" && tg && tg.openTelegramLink){ tg.openTelegramLink("https://t.me/share/url?url="+encodeURIComponent(link)+"&text="+encodeURIComponent(txt)); }
      else { navigator.clipboard.writeText(txt + "\n" + link); toast("Invite link copied",CYAN); }
    }catch(e){ toast("Share unavailable",RED); }
  }
  function whenCloudReady(fn, tries){
    if(_cloudReady) return void fn();
    if((tries||0) > 40) return;            // give up after ~8s
    setTimeout(()=>whenCloudReady(fn,(tries||0)+1), 200);
  }
  // Dismissible celebratory card so referral XP is never missed (toasts are too easy to miss).
  function referralPopup(title, sub){
    let el=document.getElementById("refPop");
    if(!el){ el=document.createElement("div"); el.id="refPop";
      el.style.cssText="position:fixed;inset:0;z-index:60;display:none;align-items:center;justify-content:center;background:rgba(7,3,24,.75)";
      el.addEventListener("click",()=>{ el.style.display="none"; });
      document.body.appendChild(el);
    }
    el.innerHTML='<div style="background:#0b0f1a;border:2px solid '+GOLD+';border-radius:16px;padding:26px 22px;max-width:300px;text-align:center;box-shadow:0 0 30px rgba(255,210,63,.4)">'+
      '<div style="font-size:42px">🦖</div>'+
      '<h2 style="color:'+GOLD+';margin:.3em 0;font-size:19px">'+title+'</h2>'+
      '<p style="opacity:.85;font-size:13px;line-height:1.5">'+sub+'</p>'+
      '<button class="btn" style="margin-top:14px">LET’S GO</button></div>';
    el.style.display="flex";
    try{ if(tg&&tg.HapticFeedback) tg.HapticFeedback.notificationOccurred("success"); }catch(_){}
  }
  function claimReferralRewards(){
    const api=econApi(), init=tgInit(); if(!api||!init) return;
    fetch(api+"/refer-claim",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({initData:init})})
      .then(r=>r.json()).then(d=>{ if(d&&d.ok){
        if(typeof d.count==="number") store.set("xz_ref_count", d.count);   // persist for the RANKS stat
        if(d.reward>0){ econ.tokens+=d.reward; saveEcon(); updateHUDtokens();
          referralPopup("+"+fmt(d.reward)+" XP!", (d.count||0)+" friend"+((d.count||0)>1?"s":"")+" joined from your invite. Keep sharing to climb the TOP INVITERS board!");
        }
      } }).catch(()=>{});
  }
  function processIncomingReferral(){
    const api=econApi(), init=tgInit(); if(!api||!init) return;
    const sp=(tg.initDataUnsafe&&tg.initDataUnsafe.start_param)||"";
    if(!/^[0-9]{1,20}$/.test(sp)) return;       // no/invalid referrer param
    // Self-referral guard: opening your OWN invite link must never credit you or add you
    // to the TOP INVITERS board. The Worker also rejects ref===invitee, but block it here
    // too so your own link never even fires a /refer call (matches the server's intent).
    const myId=(tg.initDataUnsafe&&tg.initDataUnsafe.user&&tg.initDataUnsafe.user.id);
    if(myId!=null && sp===String(myId)){ store.set("xz_ref_done",true); return; }
    if(store.get("xz_ref_done",false)) return;  // already processed on this device
    fetch(api+"/refer",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({initData:init,ref:sp})})
      .then(r=>r.json()).then(d=>{ if(d&&d.ok){ store.set("xz_ref_done",true);
        if(d.welcome>0){ econ.tokens+=d.welcome; saveEcon(); updateHUDtokens();
          referralPopup("Welcome! +"+fmt(d.welcome)+" XP", "You joined from a friend’s invite. Smash scammers and invite your own crew to earn more 🦖"); }
      } }).catch(()=>{});
  }

  /* ----------------------------- wallet tiers -----------------------------
   * 10 holder tiers, multiplier evenly stepped 1.1x → 2.0x (10M+ = 2.0x), plus a
   * 1.0x baseline for non/sub-10K holders. Single source of truth (TIERS) used by
   * both the in-game score multiplier and the WALLET ladder. Ordered high → low. */
  const TIERS = [
    {min:10e6, m:2.0, l:"XZILLA",      c:GOLD},
    {min:9e6,  m:1.9, l:"KRAKEN",      c:GOLD},
    {min:8e6,  m:1.8, l:"WHALE",       c:MAG},
    {min:7e6,  m:1.7, l:"SHARK",       c:MAG},
    {min:6e6,  m:1.6, l:"DOLPHIN",     c:CYAN},
    {min:5e6,  m:1.5, l:"BULL",        c:CYAN},
    {min:4e6,  m:1.4, l:"APE",         c:TEAL},
    {min:3e6,  m:1.3, l:"FISH",        c:TEAL},
    {min:2e6,  m:1.2, l:"CRAB",        c:"#9fb6c9"},
    {min:1e6,  m:1.1, l:"SHRIMP",      c:"#9fb6c9"},
    {min:0,    m:1.0, l:"PAPER HANDS", c:"#9fb6c9"}
  ];
  function tierFor(h){ for(const t of TIERS){ if(h>=t.min) return t; } return TIERS[TIERS.length-1]; }
  window.__mult = () => tierFor(econ.holdings).m;
  window.__tierFor = tierFor;   // shared with the start-screen UI so it shows the REAL tiered multiplier
  const tierByLabel = l => TIERS.find(t=>t.l===l) || null;

  /* Public holder flex. `tier` on a leaderboard row is stamped by the WORKER after it
   * re-reads the wallet on-chain, never by the client — so this badge can't be faked by
   * editing a request. Rows with no verified wallet simply render nothing. */
  function holderBadge(entry){
    const t = entry && entry.tier && tierByLabel(entry.tier);
    if(!t) return "";
    return ' <span class="hbadge" style="color:'+t.c+';border-color:'+t.c+'">◆ '+t.l+' '+t.m+'×</span>';
  }

  /* -------------------------------- skins --------------------------------- */
  const SKINS = [
    {id:"default", name:"OG GREEN",      tint:null,   cost:0},
    {id:"violet",  name:"DEGEN VIOLET",  tint:MAG,    cost:1500},
    {id:"cyan",    name:"PAPERHAND ICE", tint:CYAN,   cost:4000},
    {id:"gold",    name:"PUMP GOLD",     tint:GOLD,   cost:9000},
    // RANK REWARDS — earned by reaching a milestone (best score), not bought with XP.
    {id:"blood",   name:"RUG RED",       tint:RED,    cost:0, rankReq:16000, rankName:"WHALE WRECKER"},
    {id:"toxic",   name:"ONCHAIN GLOW",  tint:TEAL,   cost:0, rankReq:68000, rankName:"APEX PREDATOR"}
  ];
  // Recolor the WHOLE Xrider+bike to the skin's color. THREE's material.color only
  // MULTIPLIES the texture (can't brighten → muddy), so instead we bake a per-skin
  // texture: pixel = luminance × tint, preserving the silhouette + shading. We load the
  // source art from its own CORS image (NOT the in-scene texture) so we never bake the
  // loading PLACEHOLDER sprite into a skin. The default skin uses the untinted art.
  // TWO-LAYER Xzilla art (MainCol/): Main_Character.webp = the ORIGINAL black rider body + tyre
  // (NEVER recoloured); Main_Bike.webp = the recolourable layer (mohawk, "Xzilla" logo, green
  // accents + the chrome bike hardware). Each is a 1×4 vertical sheet of 640×640 frames. A skin
  // recolours ONLY the bike layer, then we composite bike-UNDER-character into one texture and
  // cycle the 4 frames via repeat+offset in the render loop (#tire-anim). Same-origin paths so
  // the recolour canvas isn't tainted on GitHub Pages.
  const BIKE_URL="MainCol/Main_Bike.webp", CHAR_URL="MainCol/Main_Character.webp";
  const BIKER_COLS=1, BIKER_ROWS=4, BIKER_FRAMES=4;
  window.__BIKER={cols:BIKER_COLS, rows:BIKER_ROWS, frames:BIKER_FRAMES};
  let _bikeBase=null, _charBase=null, _riderLoading=false, _riderOrigTex=null, _skinLastId=null, _skinRetry=0;
  const _skinTex={};
  function _ensureRiderBase(cb){          // load BOTH layers; fire cb once both are ready
    if(_bikeBase && _charBase){ cb&&cb(); return; }
    if(_riderLoading) return;
    _riderLoading=true;
    let pending=2; const done=()=>{ if(--pending===0){ _riderLoading=false; cb&&cb(); } };
    const load=(url,set)=>{ const im=new Image(); im.crossOrigin="anonymous";
      im.onload=()=>{ set(im); done(); };
      im.onerror=()=>{ _riderLoading=false; };
      try{ im.src=url; }catch(e){ _riderLoading=false; } };
    load(BIKE_URL, im=>{ _bikeBase=im; });
    load(CHAR_URL, im=>{ _charBase=im; });
  }
  function _frameRepeat(t){ if(t&&t.repeat) t.repeat.set(1/BIKER_COLS, 1/BIKER_ROWS); return t; }   // show a single frame
  // Recolour the BIKE layer to `tint` (luminance × tint keeps the chrome shading); tint=null →
  // original bike untouched. Returns a canvas, or null if the source can't be read (tainted).
  function _recolorBike(tint){
    const b=_bikeBase, w=b.naturalWidth||b.width, h=b.naturalHeight||b.height;
    const c=document.createElement("canvas"); c.width=w; c.height=h;
    const x=c.getContext("2d"); x.drawImage(b,0,0,w,h);
    if(!tint) return c;
    let id; try{ id=x.getImageData(0,0,w,h); }catch(e){ return null; }
    const d=id.data, col=new THREE.Color(tint), tr=col.r, tg=col.g, tb=col.b;
    for(let i=0;i<d.length;i+=4){
      let a=d[i+3]; if(!a) continue;
      if(a<170){ a=Math.round(a*a/170); d[i+3]=a; if(!a) continue; }   // soften edge aura → no halo
      let lum=(0.299*d[i]+0.587*d[i+1]+0.114*d[i+2])/255;
      lum=Math.min(1, Math.pow(lum,0.72));          // brighten midtones, keep darks dark
      d[i]=tr*255*lum; d[i+1]=tg*255*lum; d[i+2]=tb*255*lum; }
    x.putImageData(id,0,0);
    return c;
  }
  function _riderTexFor(tint){   // composite: recoloured bike UNDER the original Xzilla body
    if(tint){ if(_skinTex[tint]) return _skinTex[tint]; } else if(_riderOrigTex) return _riderOrigTex;
    if(!_bikeBase || !_charBase) return null;
    const bikeC=_recolorBike(tint); if(!bikeC) return null;
    const w=_charBase.naturalWidth||_charBase.width, h=_charBase.naturalHeight||_charBase.height;
    const c=document.createElement("canvas"); c.width=w; c.height=h;
    const x=c.getContext("2d");
    x.drawImage(bikeC,0,0);              // recoloured (or original) bike underneath
    x.drawImage(_charBase,0,0,w,h);      // ORIGINAL Xzilla body on top — never recoloured
    const t=new THREE.CanvasTexture(c);
    try{ t.encoding=THREE.sRGBEncoding; }catch(e){}
    _frameRepeat(t);
    if(tint) _skinTex[tint]=t; else _riderOrigTex=t;
    return t;
  }
  function applySkin(){
    const s=SKINS.find(s=>s.id===econ.skin), tint=(s&&s.tint)||null;
    try{ _applyHeroSkin(tint); }catch(e){}   // also recolor the start-screen hero image
    if(econ.skin!==_skinLastId){ _skinLastId=econ.skin; _skinRetry=0; }
    try{
      const tex=_riderTexFor(tint);
      if(tex){ player.material.map=tex; player.material.color.set("#ffffff"); player.material.needsUpdate=true; }
      else {
        // Source art not loaded yet — leave the in-scene texture as-is (no placeholder
        // baking, no colour fallback), load the real art, then re-apply.
        _ensureRiderBase(()=>{ try{ applySkin(); }catch(e){} });
        if(_skinRetry++ < 30) setTimeout(applySkin, 300);
      }
    }catch(e){}
  }
  // The main/start screen shows a separate static <img id="heroImg">. Recolour it with the SAME
  // two-layer split as the in-game sprite (mainImage/Hero_Bike.webp recolours; Hero_Character.webp
  // stays original) so the menu matches gameplay: skin tints the bike, Xzilla's body stays black.
  // Default skin keeps the untouched original promo art.
  const _heroImgEl = document.getElementById("heroImg");
  const _heroUrl = _heroImgEl ? _heroImgEl.getAttribute("src") : null;
  const HERO_BIKE_URL="mainImage/Hero_Bike.webp", HERO_CHAR_URL="mainImage/Hero_Character.webp";
  let _heroBike=null, _heroChar=null, _heroLoading=false; const _heroData={};
  function _ensureHeroBase(cb){          // load BOTH hero layers; fire cb once both are ready
    if(_heroBike && _heroChar){ cb&&cb(); return; }
    if(_heroLoading) return;
    _heroLoading=true;
    let pending=2; const done=()=>{ if(--pending===0){ _heroLoading=false; cb&&cb(); } };
    const load=(url,set)=>{ const im=new Image(); im.crossOrigin="anonymous";
      im.onload=()=>{ set(im); done(); };
      im.onerror=()=>{ _heroLoading=false; };
      try{ im.src=url; }catch(e){ _heroLoading=false; } };
    load(HERO_BIKE_URL, im=>{ _heroBike=im; });
    load(HERO_CHAR_URL, im=>{ _heroChar=im; });
  }
  function _applyHeroSkin(tint){
    const hero=_heroImgEl; if(!hero) return;
    if(!tint){ if(_heroUrl && hero.src!==_heroUrl) hero.src=_heroUrl; return; }   // default → original promo art
    if(_heroData[tint]){ hero.src=_heroData[tint]; return; }
    if(!_heroBike || !_heroChar){ _ensureHeroBase(()=>{ try{ _applyHeroSkin(tint); }catch(e){} }); return; }
    try{
      const w=_heroChar.naturalWidth||_heroChar.width, h=_heroChar.naturalHeight||_heroChar.height;
      // recolour the bike layer (luminance × tint), then composite it UNDER the original body
      const bc=document.createElement("canvas"); bc.width=w; bc.height=h;
      const bx=bc.getContext("2d"); bx.drawImage(_heroBike,0,0,w,h);
      const id=bx.getImageData(0,0,w,h), d=id.data, col=new THREE.Color(tint), tr=col.r, tg=col.g, tb=col.b;
      for(let i=0;i<d.length;i+=4){
        let a=d[i+3]; if(!a) continue;
        if(a<170){ a=Math.round(a*a/170); d[i+3]=a; if(!a) continue; }
        let lum=(0.299*d[i]+0.587*d[i+1]+0.114*d[i+2])/255;
        lum=Math.min(1, Math.pow(lum,0.72));
        d[i]=tr*255*lum; d[i+1]=tg*255*lum; d[i+2]=tb*255*lum; }
      bx.putImageData(id,0,0);
      const c=document.createElement("canvas"); c.width=w; c.height=h;
      const x=c.getContext("2d"); x.drawImage(bc,0,0); x.drawImage(_heroChar,0,0,w,h);
      const url=c.toDataURL(); _heroData[tint]=url; hero.src=url;
    }catch(e){}   // tainted canvas → leave original
  }
  // Auto-grant rank-reward skins once the player's best score clears the threshold.
  function syncRankSkins(){
    let changed=false;
    SKINS.forEach(s=>{ if(s.rankReq && (state.best||0)>=s.rankReq && !econ.skins.includes(s.id)){
      econ.skins.push(s.id); changed=true; toast("Rank reward unlocked: "+s.name+" skin",GOLD); } });
    if(changed) saveEcon();
  }

  /* ------------------------------ missions -------------------------------- */
  const DEFAULT_MISSIONS = [
    {id:"k",  text:"Destroy 60 scammers",        goal:60,    prog:0, reward:1500,  done:false, stat:"kills"},
    {id:"k2", text:"Destroy 250 scammers",       goal:250,   prog:0, reward:4000,  done:false, stat:"kills"},
    {id:"k3", text:"Destroy 1,000 scammers",     goal:1000,  prog:0, reward:12000, done:false, stat:"kills"},
    {id:"k4", text:"Destroy 3,000 scammers",     goal:3000,  prog:0, reward:30000, done:false, stat:"kills"},
    {id:"b",  text:"Defeat 3 Rug Bosses",        goal:3,     prog:0, reward:3000,  done:false, stat:"boss"},
    {id:"b2", text:"Defeat 15 Rug Bosses",       goal:15,    prog:0, reward:9000,  done:false, stat:"boss"},
    {id:"b3", text:"Defeat 40 Rug Bosses",       goal:40,    prog:0, reward:22000, done:false, stat:"boss"},
    {id:"b4", text:"Defeat 100 Rug Bosses",      goal:100,   prog:0, reward:55000, done:false, stat:"boss"},
    {id:"c",  text:"Land an x12 combo",          goal:12,    prog:0, reward:2500,  done:false, stat:"combo"},
    {id:"c2", text:"Land an x25 combo",          goal:25,    prog:0, reward:6000,  done:false, stat:"combo"},
    {id:"c3", text:"Land an x40 combo",          goal:40,    prog:0, reward:14000, done:false, stat:"combo"},
    {id:"c4", text:"Land an x60 combo",          goal:60,    prog:0, reward:30000, done:false, stat:"combo"},
    {id:"s",  text:"Score 6,000 in one run",     goal:6000,  prog:0, reward:5000,  done:false, stat:"score"},
    {id:"s2", text:"Score 12,000 in one run",    goal:12000, prog:0, reward:10000, done:false, stat:"score"},
    {id:"s3", text:"Score 18,000 in one run",    goal:18000, prog:0, reward:18000, done:false, stat:"score"},
    {id:"s4", text:"Score 25,000 in one run",    goal:25000, prog:0, reward:30000, done:false, stat:"score"},
    {id:"s5", text:"Score 40,000 in one run",    goal:40000, prog:0, reward:60000, done:false, stat:"score"}
  ];
  let missions = store.get("xz_missions", null);
  if(!Array.isArray(missions)) missions = DEFAULT_MISSIONS.map(m=>({...m}));
  else {
    // migrate older saves to the full bounty set: keep earned progress by id,
    // refresh text/goal/reward (also retires the old "Beach 3 Glitch Whales" typo).
    const prev={}; missions.forEach(m=>{ prev[m.id]=m; });
    missions = DEFAULT_MISSIONS.map(d=>{
      const ex=prev[d.id];
      return ex ? {...d, prog:ex.prog||0, done:!!ex.done} : {...d};
    });
  }
  function saveMissions(){ store.set("xz_missions", missions); }

  /* ------------------------- daily challenge ------------------------------ */
  /* A single goal that refreshes each calendar day (deterministic from the date,
   * so it's stable across reloads) and pays out XP once on completion. Progress is
   * tallied from each run's stats at game over. */
  const DAILY_POOL = [
    {type:"kills", goal:60,    reward:2200, text:g=>"Smash "+g+" scammers today"},
    {type:"kills", goal:100,   reward:3000, text:g=>"Smash "+g+" scammers today"},
    {type:"kills", goal:150,   reward:4200, text:g=>"Wipe out "+g+" scammers today"},
    {type:"kills", goal:220,   reward:5800, text:g=>"Go on a "+g+"-scammer rampage"},
    {type:"score", goal:5000,  reward:2600, text:g=>"Score "+fmt(g)+" in a single run"},
    {type:"score", goal:8000,  reward:3600, text:g=>"Score "+fmt(g)+" in a single run"},
    {type:"score", goal:12000, reward:5000, text:g=>"Score "+fmt(g)+" in a single run"},
    {type:"boss",  goal:2,     reward:3000, text:g=>"Defeat "+g+" Rug Bosses today"},
    {type:"boss",  goal:4,     reward:4500, text:g=>"Defeat "+g+" Rug Bosses today"},
    {type:"boss",  goal:6,     reward:6200, text:g=>"Hunt down "+g+" Rug Bosses today"},
    {type:"combo", goal:12,    reward:2800, text:g=>"Land an x"+g+" combo"},
    {type:"combo", goal:20,    reward:3800, text:g=>"Land an x"+g+" combo"},
    {type:"combo", goal:30,    reward:5200, text:g=>"Chain an x"+g+" combo"}
  ];
  const todayStr = () => new Date().toDateString();
  let daily = store.get("xz_daily", null);
  function rollDaily(){
    const day=todayStr();
    const seed=[...day].reduce((a,c)=>a+c.charCodeAt(0),0);   // date-derived pick → same all day
    let idx=seed%DAILY_POOL.length;
    // variety: never repeat the previous day's exact challenge (keeps the per-day
    // determinism above — only nudges off a back-to-back duplicate).
    if(daily && daily.idx===idx && DAILY_POOL.length>1) idx=(idx+1)%DAILY_POOL.length;
    const pick=DAILY_POOL[idx];
    daily={day, idx, type:pick.type, goal:pick.goal, reward:pick.reward, text:pick.text(pick.goal), prog:0, done:false};
    store.set("xz_daily", daily);
  }
  function ensureDaily(){ if(!daily || daily.day!==todayStr()) rollDaily(); }
  function progressDaily(){
    ensureDaily(); if(daily.done) return;
    if(daily.type==="kills")      daily.prog += run.kills;
    else if(daily.type==="boss")  daily.prog += run.boss;
    else if(daily.type==="score") daily.prog = Math.max(daily.prog, run.score);
    else if(daily.type==="combo") daily.prog = Math.max(daily.prog, run.combo);
    if(daily.prog>=daily.goal){
      daily.done=true; econ.tokens+=daily.reward; saveEcon(); updateHUDtokens();
      toast("Daily challenge complete! +"+fmt(daily.reward)+" XP",GOLD);
      try{ window.__buzz && window.__buzz([40,30,80],"success"); }catch(_){}
    }
    store.set("xz_daily", daily);
  }

  /* ------------------------- weekly challenge ----------------------------- */
  /* A bigger goal that refreshes once per ~7-day bucket and pays a fat XP reward.
   * Progress accumulates across every run in the week (kills/boss add up; score &
   * combo take the best). Deterministic pick from the week bucket, like the daily. */
  const WEEKLY_POOL = [
    {type:"kills", goal:500,   reward:12000, text:g=>"Smash "+fmt(g)+" scammers this week"},
    {type:"kills", goal:1000,  reward:18000, text:g=>"Smash "+fmt(g)+" scammers this week"},
    {type:"kills", goal:1500,  reward:24000, text:g=>"Purge "+fmt(g)+" scammers this week"},
    {type:"boss",  goal:15,    reward:15000, text:g=>"Defeat "+fmt(g)+" Rug Bosses this week"},
    {type:"boss",  goal:30,    reward:22000, text:g=>"Defeat "+fmt(g)+" Rug Bosses this week"},
    {type:"boss",  goal:50,    reward:32000, text:g=>"Hunt "+fmt(g)+" Rug Bosses this week"},
    {type:"score", goal:12000, reward:15000, text:g=>"Hit "+fmt(g)+" in a single run this week"},
    {type:"score", goal:20000, reward:22000, text:g=>"Hit "+fmt(g)+" in a single run this week"},
    {type:"score", goal:30000, reward:32000, text:g=>"Hit "+fmt(g)+" in a single run this week"},
    {type:"combo", goal:25,    reward:14000, text:g=>"Land an x"+g+" combo this week"},
    {type:"combo", goal:40,    reward:20000, text:g=>"Chain an x"+g+" combo this week"}
  ];
  const weekBucket = () => Math.floor(Date.now()/6048e5);   // ~1-week buckets (same as the weekly board)
  let weekly = store.get("xz_weekly", null);
  function rollWeekly(){
    const wk=weekBucket();
    let idx=wk%WEEKLY_POOL.length;
    // variety: don't repeat last week's exact challenge (deterministic per bucket).
    if(weekly && weekly.idx===idx && WEEKLY_POOL.length>1) idx=(idx+1)%WEEKLY_POOL.length;
    const pick=WEEKLY_POOL[idx];
    weekly={week:wk, idx, type:pick.type, goal:pick.goal, reward:pick.reward, text:pick.text(pick.goal), prog:0, done:false};
    store.set("xz_weekly", weekly);
  }
  function ensureWeekly(){ if(!weekly || weekly.week!==weekBucket()) rollWeekly(); }
  function progressWeekly(){
    ensureWeekly(); if(weekly.done) return;
    if(weekly.type==="kills")      weekly.prog += run.kills;
    else if(weekly.type==="boss")  weekly.prog += run.boss;
    else if(weekly.type==="score") weekly.prog = Math.max(weekly.prog, run.score);
    else if(weekly.type==="combo") weekly.prog = Math.max(weekly.prog, run.combo);
    if(weekly.prog>=weekly.goal){
      weekly.done=true; econ.tokens+=weekly.reward; saveEcon(); updateHUDtokens();
      toast("Weekly challenge complete! +"+fmt(weekly.reward)+" XP",GOLD);
      try{ window.__buzz && window.__buzz([40,30,80],"success"); }catch(_){}
    }
    store.set("xz_weekly", weekly);
  }

  /* ----------------------------- leaderboard ------------------------------ */
  /* run-score milestones — purely cosmetic titles, separate from the wallet-holdings VIP tiers */
  // Thresholds rescaled UP after the upgrade/scoring update (2× ruggers, BOSS HUNTER,
  // OVERCLOCK, faster gears) inflated scores — the old top rank (18k) was trivial once a
  // player had upgrades. Early ranks stay gentle for newcomers; the top end stretches so
  // XZILLA LEGEND (100k) is a real endgame achievement again.
  /* `c` groups the ten titles into five colour bands, two ranks each, on the SAME
     grey -> teal -> cyan -> magenta -> gold ramp the holder TIERS table uses. One ramp for
     "how far up are you" across the whole game, so a colour means the same thing in the
     rank panel as it does on a leaderboard badge. Purely additive — every other consumer
     of this table reads only .name/.score. */
  const SCORE_TITLES = [
    {score:300,    name:"SCAM SPOTTER",    c:"#9fb6c9"},
    {score:900,    name:"RUG DODGER",      c:"#9fb6c9"},
    {score:2000,   name:"FUD SLAYER",      c:TEAL},
    {score:4500,   name:"KOL CRUSHER",     c:TEAL},
    {score:9000,   name:"DEGEN DESTROYER", c:CYAN},
    {score:16000,  name:"WHALE WRECKER",   c:CYAN},
    {score:28000,  name:"CHAIN GUARDIAN",  c:MAG},
    {score:45000,  name:"KAIJU AWAKENED",  c:MAG},
    {score:68000,  name:"APEX PREDATOR",   c:GOLD},
    {score:100000, name:"XZILLA LEGEND",   c:GOLD}
  ];
  // Colour of the band the player is standing in. Unranked (below the first milestone)
  // sits in the bottom grey band rather than falling back to gold, which would read as
  // "top tier" to anyone glancing at the bar.
  const RANK_UNRANKED_COLOR = "#9fb6c9";
  function rankColor(title){ return (title && title.c) || RANK_UNRANKED_COLOR; }
  // The five bands, derived from the table rather than restated — add or recolour a title
  // and the strip below follows automatically instead of silently disagreeing.
  const RANK_BANDS = (function(){
    const b=[];
    for(const t of SCORE_TITLES){ if(!b.length || b[b.length-1].c!==t.c) b.push({c:t.c, from:t.score}); }
    return b;
  })();
  function titleForScore(score){
    // Highest tier whose threshold the score actually clears. Scans every entry and
    // keeps the max-threshold match, so it can never over-rank (e.g. award APEX
    // PREDATOR at a low score) even if SCORE_TITLES is ever reordered — no reliance
    // on ascending sort order or an early `break`.
    let t=null;
    for(const tier of SCORE_TITLES){ if(score>=tier.score && (!t || tier.score>t.score)) t=tier; }
    return t;
  }
  function tgName(){
    try { const u = tg && tg.initDataUnsafe && tg.initDataUnsafe.user;
      if(u) return (u.username ? "@"+u.username : (u.first_name||"YOU")); } catch(e){}
    return "YOU";
  }
  // No fake rivals, no per-run spam — just your single best score on record, with
  // your real Telegram name when the game is opened inside Telegram.
  let myBest = store.get("xz_mybest", null);
  let weekBest = store.get("xz_weekbest", 0);   // best of the CURRENT week (reset by weeklyReset)
  function pushScore(score){
    const s = Math.round(score);
    if(!myBest || s>myBest.score) myBest = {name:tgName(), score:s};
    else myBest.name = tgName();   // keep the name fresh even on a non-record run
    store.set("xz_mybest", myBest);
    if(s>weekBest){ weekBest=s; store.set("xz_weekbest", weekBest); }
  }

  /* ------------------------- per-run stat tracking ------------------------ */
  const run = {kills:0, boss:0, combo:0, score:0, earned:0, lastTitle:null};
  function resetRun(){ run.kills=0; run.boss=0; run.combo=0; run.score=0; run.earned=0; run.lastTitle=null; }

  /* === ANCHOR: ART === */
  /* ======================================================================== *
   *  CANVAS-TEXTURE ART (higher-res, full characters)                        *
   * ======================================================================== */
  function makeTex(draw, S){
    S = S||512;
    const c=document.createElement("canvas"); c.width=c.height=S;
    const x=c.getContext("2d"); draw(x,S);
    const t=new THREE.CanvasTexture(c); t.encoding=THREE.sRGBEncoding; return t;
  }
  function spriteMat(draw, S){
    return new THREE.SpriteMaterial({ map:makeTex(draw,S), transparent:true, depthWrite:false });
  }
  function spriteMatURL(url, draw, S){
    const m=spriteMat(draw,S);
    if(url && !/YOUR_/.test(url) && url.length>4){ const l=new THREE.TextureLoader(); l.setCrossOrigin("anonymous");
      l.load(url,t=>{ t.encoding=THREE.sRGBEncoding; m.map=t; m.needsUpdate=true; },undefined,()=>{}); }
    return m;
  }
  function glowBG(x,S,color,r,a){
    const g=x.createRadialGradient(S/2,S*0.46,8,S/2,S*0.46,r||S*0.5);
    g.addColorStop(0,color+(a||"aa")); g.addColorStop(.55,color+"22"); g.addColorStop(1,color+"00");
    x.fillStyle=g; x.fillRect(0,0,S,S);
  }
  function roundRect(x,X,Y,W,H,r){ x.beginPath(); x.moveTo(X+r,Y);
    x.arcTo(X+W,Y,X+W,Y+H,r); x.arcTo(X+W,Y+H,X,Y+H,r);
    x.arcTo(X,Y+H,X,Y,r);     x.arcTo(X,Y,X+W,Y,r); x.closePath(); }
  function label(x,S,txt,color){
    x.font="bold 30px 'Press Start 2P', Orbitron, monospace"; x.textAlign="center"; x.textBaseline="middle";
    x.fillStyle="#0a0014"; x.fillRect(S*0.18,S-58,S*0.64,40);
    x.strokeStyle=color; x.lineWidth=3; x.strokeRect(S*0.18,S-58,S*0.64,40);
    x.font="14px 'Press Start 2P', Orbitron, monospace"; x.fillStyle=color;
    x.shadowColor=color; x.shadowBlur=10; x.fillText(txt,S/2,S-37); x.shadowBlur=0;
  }

  // Scammer / KOL / Rugger / Snake / Fudster — hooded body + neon head + icon
  function drawScammer2(x,S,cfg){
    const cx=S/2;
    glowBG(x,S,cfg.c1, S*0.52, "99");
    // body / hoodie
    x.save(); x.shadowColor=cfg.c1; x.shadowBlur=24;
    const bg=x.createLinearGradient(0,S*0.42,0,S*0.96);
    bg.addColorStop(0,cfg.c2); bg.addColorStop(1,"#140006");
    x.fillStyle=bg; roundRect(x,cx-118,S*0.46,236,S*0.46,46); x.fill(); x.restore();
    x.strokeStyle=cfg.c2; x.lineWidth=5; x.shadowColor=cfg.c2; x.shadowBlur=14;
    roundRect(x,cx-118,S*0.46,236,S*0.46,46); x.stroke(); x.shadowBlur=0;
    // head
    const R=92, hy=S*0.40;
    if(cfg.horns){ x.fillStyle=cfg.c2; x.shadowColor=cfg.c2; x.shadowBlur=14;
      hornAt(x,cx-R*0.7,hy-R*0.55,-1); hornAt(x,cx+R*0.7,hy-R*0.55,1); x.shadowBlur=0; }
    const hg=x.createRadialGradient(cx-26,hy-26,10,cx,hy,R);
    hg.addColorStop(0,cfg.c2); hg.addColorStop(.5,cfg.c1); hg.addColorStop(1,"#180006");
    x.save(); x.shadowColor=cfg.c1; x.shadowBlur=28; x.fillStyle=hg;
    x.beginPath(); x.arc(cx,hy,R,0,7); x.fill(); x.restore();
    x.strokeStyle=cfg.c2; x.lineWidth=5; x.shadowColor=cfg.c2; x.shadowBlur=12;
    x.beginPath(); x.arc(cx,hy,R,0,7); x.stroke(); x.shadowBlur=0;
    // eyes
    const ey=hy-6, ex=34;
    eye(x,cx-ex,ey,cfg); eye(x,cx+ex,ey,cfg);
    x.strokeStyle="#180006"; x.lineWidth=9; x.lineCap="round"; x.beginPath();
    x.moveTo(cx-ex-22,ey-22); x.lineTo(cx-ex+18,ey-6);
    x.moveTo(cx+ex+22,ey-22); x.lineTo(cx+ex-18,ey-6); x.stroke();
    // jagged grin
    x.strokeStyle="#180006"; x.lineWidth=6; x.beginPath(); let mx=cx-44,my=hy+44; x.moveTo(mx,my);
    for(let i=0;i<9;i++){ mx+=11; my+=(i%2?11:-11); x.lineTo(mx,my); } x.stroke();
    if(cfg.nose){ x.fillStyle="#ff3b3b"; x.shadowColor="#ff3b3b"; x.shadowBlur=12;
      x.beginPath(); x.arc(cx,hy+16,13,0,7); x.fill(); x.shadowBlur=0; }
    // floating icon
    x.font="46px serif"; x.textAlign="center"; x.textBaseline="middle";
    x.fillText(cfg.icon||"💸", cx+108, hy-96);
    label(x,S,cfg.label,cfg.c2);
  }
  function hornAt(x,X,Y,d){ x.beginPath(); x.moveTo(X,Y);
    x.quadraticCurveTo(X+d*14,Y-58,X+d*40,Y-38);
    x.quadraticCurveTo(X+d*20,Y-20,X,Y); x.fill(); }
  function eye(x,X,Y,cfg){ x.fillStyle="#fff"; x.shadowColor="#fff"; x.shadowBlur=6;
    x.beginPath(); x.ellipse(X,Y,19,15,0,0,7); x.fill(); x.shadowBlur=0;
    x.fillStyle=cfg.eye||"#ff2b2b";
    if(cfg.slit){ x.beginPath(); x.ellipse(X,Y,5,14,0,0,7); x.fill(); }
    else { x.beginPath(); x.arc(X,Y,8,0,7); x.fill(); } }

  // HODLER — friendly diamond, clearly "do not hit"
  function drawHolder2(x,S){
    const cx=S/2, top=S*0.18, gir=S*0.40, bot=S*0.74, w=96;
    glowBG(x,S,CYAN,S*0.52,"99");
    const g=x.createLinearGradient(0,top,0,bot);
    g.addColorStop(0,"#eafdff"); g.addColorStop(.42,"#5ef0ff"); g.addColorStop(1,"#0a9fc8");
    x.save(); x.shadowColor=CYAN; x.shadowBlur=30; x.fillStyle=g;
    x.beginPath(); x.moveTo(cx-w*0.5,top); x.lineTo(cx+w*0.5,top);
    x.lineTo(cx+w,gir); x.lineTo(cx,bot); x.lineTo(cx-w,gir); x.closePath(); x.fill(); x.restore();
    x.strokeStyle="#fff"; x.lineWidth=4; x.shadowColor="#9ff6ff"; x.shadowBlur=12;
    x.beginPath(); x.moveTo(cx-w*0.5,top); x.lineTo(cx+w*0.5,top);
    x.lineTo(cx+w,gir); x.lineTo(cx,bot); x.lineTo(cx-w,gir); x.closePath(); x.stroke();
    x.strokeStyle="rgba(255,255,255,.55)"; x.lineWidth=2; x.shadowBlur=0; x.beginPath();
    x.moveTo(cx-w*0.5,top); x.lineTo(cx,gir); x.lineTo(cx,bot);
    x.moveTo(cx+w*0.5,top); x.lineTo(cx,gir); x.moveTo(cx-w,gir); x.lineTo(cx+w,gir); x.stroke();
    spark(x,cx+44,top+26,9); spark(x,cx-34,gir+30,6);
    label(x,S,"HODLER",CYAN);
  }
  function spark(x,X,Y,r){ x.save(); x.fillStyle="#fff"; x.shadowColor="#fff"; x.shadowBlur=12; x.beginPath();
    for(let i=0;i<8;i++){ const a=i*Math.PI/4, rr=i%2?r*0.4:r; x.lineTo(X+Math.cos(a)*rr,Y+Math.sin(a)*rr); }
    x.closePath(); x.fill(); x.restore(); }

  // GLITCH WHALE boss
  function drawWhale(x,S){
    const cx=S/2, cy=S*0.44;
    glowBG(x,S,MAG,S*0.55,"aa");
    // glitch bars behind
    for(let i=0;i<6;i++){ x.fillStyle = i%2 ? "rgba(57,255,122,0.16)" : "rgba(33,230,255,0.18)";
      x.fillRect(8+(Math.random()*10), cy-120+i*40, S-16, 14); }
    // body
    const g=x.createLinearGradient(0,cy-110,0,cy+120);
    g.addColorStop(0,"#9ff6ff"); g.addColorStop(.5,CYAN); g.addColorStop(1,"#1a0a52");
    x.save(); x.shadowColor=MAG; x.shadowBlur=34; x.fillStyle=g;
    x.beginPath(); x.ellipse(cx,cy,168,120,0,0,7); x.fill(); x.restore();
    // tail
    x.fillStyle=CYAN; x.beginPath(); x.moveTo(cx-150,cy);
    x.lineTo(cx-220,cy-70); x.lineTo(cx-200,cy); x.lineTo(cx-220,cy+70); x.closePath(); x.fill();
    // outline
    x.strokeStyle=MAG; x.lineWidth=6; x.shadowColor=MAG; x.shadowBlur=16;
    x.beginPath(); x.ellipse(cx,cy,168,120,0,0,7); x.stroke(); x.shadowBlur=0;
    // eye
    x.fillStyle="#fff"; x.beginPath(); x.arc(cx+70,cy-30,26,0,7); x.fill();
    x.fillStyle=RED; x.beginPath(); x.arc(cx+78,cy-30,12,0,7); x.fill();
    // spout $
    x.font="bold 60px Orbitron, sans-serif"; x.fillStyle=GOLD; x.shadowColor=GOLD; x.shadowBlur=18;
    x.textAlign="center"; x.fillText("$",cx+30,cy-118); x.shadowBlur=0;
    label(x,S,"GLITCH WHALE",MAG);
  }
  function drawShield2(x,S){ glowBG(x,S,TEAL,S*0.5,"99"); const cx=S/2,cy=S*0.44;
    const g=x.createLinearGradient(0,cy-120,0,cy+140); g.addColorStop(0,"#bfffd6"); g.addColorStop(1,"#0fbf5a");
    x.save(); x.shadowColor=TEAL; x.shadowBlur=26; x.fillStyle=g; x.beginPath();
    x.moveTo(cx,cy-120); x.lineTo(cx+96,cy-80); x.lineTo(cx+96,cy+30);
    x.quadraticCurveTo(cx+96,cy+110,cx,cy+146); x.quadraticCurveTo(cx-96,cy+110,cx-96,cy+30);
    x.lineTo(cx-96,cy-80); x.closePath(); x.fill(); x.restore();
    x.strokeStyle="#eafff2"; x.lineWidth=5; x.stroke();
    x.strokeStyle="#063d1f"; x.lineWidth=16; x.lineCap="round"; x.beginPath();
    x.moveTo(cx-36,cy+10); x.lineTo(cx-6,cy+44); x.lineTo(cx+46,cy-34); x.stroke();
    label(x,S,"SHIELD",TEAL); }
  function drawBomb2(x,S){ glowBG(x,S,GOLD,S*0.5,"99"); const cx=S/2,cy=S*0.44;
    x.save(); x.shadowColor=GOLD; x.shadowBlur=26; x.fillStyle=GOLD; x.beginPath();
    for(let i=0;i<16;i++){ const a=i*Math.PI/8, r=i%2?64:128; x.lineTo(cx+Math.cos(a)*r,cy+Math.sin(a)*r); }
    x.closePath(); x.fill(); x.fillStyle="#ff7a1f"; x.beginPath(); x.arc(cx,cy,52,0,7); x.fill(); x.restore();
    x.fillStyle="#180006"; x.font="bold 56px Orbitron, sans-serif"; x.textAlign="center"; x.textBaseline="middle";
    x.fillText("$",cx,cy+2); label(x,S,"LIQUIDATE",GOLD); }

  const SCFG = [
    {label:"PAID KOL", c1:"#ff7a1f", c2:"#ffd23f", eye:"#7a1f00", nose:true,  icon:"📢", url:ASSET_BASE+"paid_kol.webp"},
    {label:"RUGGER",   c1:"#9b2bff", c2:"#d08bff", eye:"#2a0044", horns:true, icon:"📉", url:ASSET_BASE+"rugger.webp"},
    {label:"SNAKE",    c1:"#ff2bd6", c2:"#ff8be8", eye:"#5a004a", slit:true,  icon:"🐍", url:ASSET_BASE+"snake.webp"},
    {label:"FUDSTER",  c1:"#ff3b5c", c2:"#ff9a3a", eye:"#5a0010", horns:true, icon:"💀", url:ASSET_BASE+"fudster.webp"}
  ];
  const myScammerMats = SCFG.map(cfg=>spriteMatURL(cfg.url,(x,S)=>drawScammer2(x,S,cfg)));
  const myHolderMat   = spriteMatURL(HOLDER_IMAGE_URL, drawHolder2);
  const myShieldMat   = spriteMat(drawShield2);
  const myBombMat     = spriteMat(drawBomb2);
  // matWhale removed with the placeholder Glitch Whale (D2). drawWhale is still
  // used by the Rug Boss material (matRug) below, so the draw fn is retained.

  /* === ANCHOR: WORLD === */
  /* ======================================================================== *
   *  WORLD: floor, sun-streak, skyline walls, rushing pylons, player shadow   *
   * ======================================================================== */
  // Real floor surface — short grass, with a faint center lane glow
  const floorTex = makeTex((x,S)=>{
    const g=x.createLinearGradient(0,0,0,S);
    g.addColorStop(0,"#0c2410"); g.addColorStop(.55,"#0a1e0d"); g.addColorStop(1,"#060f07");
    x.fillStyle=g; x.fillRect(0,0,S,S);
    // grass blades — short dashes, slightly randomized, two-tone for texture
    const blades=2200;
    for(let i=0;i<blades;i++){
      const bx=Math.random()*S, by=Math.random()*S;
      const len=4+Math.random()*7, lean=(Math.random()-0.5)*3;
      const tone = Math.random();
      x.strokeStyle = tone>0.82 ? "rgba(80,255,140,0.55)" : tone>0.45 ? "rgba(40,170,80,0.55)" : "rgba(20,90,45,0.6)";
      x.lineWidth=1.4;
      x.beginPath(); x.moveTo(bx,by); x.lineTo(bx+lean,by-len); x.stroke();
    }
    // center lane glow (kept subtle so grass still reads)
    const lg=x.createLinearGradient(S*0.36,0,S*0.64,0);
    lg.addColorStop(0,"rgba(255,43,214,0)"); lg.addColorStop(.5,"rgba(255,43,214,0.14)"); lg.addColorStop(1,"rgba(255,43,214,0)");
    x.fillStyle=lg; x.fillRect(S*0.36,0,S*0.28,S);
  });
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(120,260),
    new THREE.MeshBasicMaterial({ map:floorTex, transparent:true, opacity:0.96, depthWrite:false, fog:true })
  );
  floor.rotation.x=-Math.PI/2; floor.position.set(0,-1.45,-46);
  /* The floor is 260 deep, so it reaches z=-176 — 120 units BEHIND the parallax skyline
   * silhouettes at z=-50/-57. It is transparent with depthWrite:false, and so are they, so
   * depth testing cannot separate them and paint order decides. Three sorts transparent
   * objects farthest-first: the silhouettes (66 and 73 units out) draw BEFORE the floor
   * (62), and the floor then repaints that whole region at 0.96 opacity — chopping the
   * bottom half off the distant buildings behind a hard horizontal edge. Pin the floor to
   * draw first, as a background surface should, so the skyline sits on top of it. */
  floor.renderOrder = -10;
  scene.add(floor);

  /* SUN REFLECTION STREAK — REMOVED.
   * It was meant to be the sun's reflection lying on the road, but it was built as a
   * THREE.Sprite, and sprites always billboard to face the camera — so instead of lying
   * flat it stood bolt upright: a 14x40 quad at z=-50 whose gradient occupies the middle
   * 28% of the texture, i.e. a ~4-unit-wide vertical bar rising 40 units into the sky.
   * The floor hid the half below the horizon, leaving a stick planted under the sun.
   * A real reflection needs a floor-aligned PlaneGeometry (rotation.x = -PI/2) laid on
   * the road, not a billboard; until someone builds that, no streak beats a popsicle. */

  // Skyline + roadside are (re)built by environmentOverhaulV2 below: 3D crypto
  // towers fill skyline[], and the lane is left empty (pylons[] stays cleared).
  // The old canvas-textured building planes and low-poly trees used to be generated
  // here and then *instantly disposed* by that overhaul — pure startup allocation/GC
  // waste that never rendered a single frame — so the generation is removed. We keep
  // only the arrays + span constants the recycle loop and the overhaul rely on. (D1)
  const skyline=[]; const SKY_PER=7, SKY_GAP=11, SKY_SPAN=SKY_PER*SKY_GAP;
  const pylons=[];

  // Player contact shadow
  const shadow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeTex((x,S)=>{ const g=x.createRadialGradient(S/2,S/2,4,S/2,S/2,S/2);
      g.addColorStop(0,"rgba(0,0,0,0.55)"); g.addColorStop(1,"rgba(0,0,0,0)"); x.fillStyle=g; x.fillRect(0,0,S,S); },128),
    transparent:true, depthWrite:false, fog:true, opacity:0.7 }));
  shadow.scale.set(3,1.1,1); shadow.position.set(0,-1.34,PLAYER_Z); scene.add(shadow);

  // dim existing helper grids so the new floor reads, keep them as crisp lines
  try { grid.visible=false; grid2.visible=false; } catch(e){}

  /* ------------------------------- BLOOM ---------------------------------- */
  let composer=null, bloom=null;
  try {
    if(THREE.EffectComposer && THREE.RenderPass && THREE.UnrealBloomPass){
      composer = new THREE.EffectComposer(renderer);
      composer.addPass(new THREE.RenderPass(scene,camera));
      bloom = new THREE.UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight), 0.95, 0.65, 0.82);
      composer.addPass(bloom);
      window.__composer = composer;
    }
  } catch(e){ composer=null; }
  // (D3) removed unused viewH() helper — resizeComposer reads getViewportSize() directly.
  // Keep the bloom composer locked to the SAME size as renderer.setSize() in
  // index.html (both from getViewportSize) — mixing innerWidth here caused the
  // post-processed frame to mismatch the canvas and clip on mobile.
  // Composer matches the full canvas; the bloom pass renders at HALF resolution
  // (¼ the fragments). Bloom is blurred + additively composited, so half-res is
  // visually ~identical but far cheaper — the biggest mobile GPU win here. (P1)
  const resizeComposer = ()=>{ if(composer){ const v=window.getViewportSize();
    composer.setSize(v.w, v.h); if(bloom) bloom.setSize(v.w*0.5, v.h*0.5); } };
  window.addEventListener("resize", resizeComposer);
  if(window.visualViewport) window.visualViewport.addEventListener("resize", resizeComposer);
  resizeComposer();   // apply half-res bloom immediately (no resize event fires on a plain load)

  /* === ANCHOR: BOSS === */
  /* ======================================================================== *
   *  BOSS                                                                     *
   * ======================================================================== */
  TYPE.BOSS = 4;   // retained: referenced by the hit-stop set, the ad-screen boss check, and run reset
  // The placeholder "Glitch Whale" boss (bossPending / bossActive() / spawnBoss() /
  // matWhale) was fully superseded by the operational Rug Boss in the SET2 layer and
  // never actually spawned, so it has been removed. bigBanner stays — the Rug Boss
  // uses it for its "⚠ RUG BOSS ⚠" / "RUGGED THE RUGGER" callouts. (D2)
  function bigBanner(text){
    const b=document.getElementById("banner");
    b.textContent=text; b.classList.add("mega");
    b.classList.remove("banner-show"); void b.offsetWidth; b.classList.add("banner-show");
    setTimeout(()=>b.classList.remove("mega"),1400);
  }

  /* === ANCHOR: CORE_LOOP === */
  /* ======================================================================== *
   *  OVERRIDES (these symbols are called internally by name -> reassign works) *
   * ======================================================================== */
  window.addScore = function(base, worldPos){
    // __pumpMult is the live-chart modifier (see PUMP MODE) — 1 unless $XZILLA is green.
    const m = (state.combo>1?state.combo:1) * window.__mult() * (window.__scoreMult||1) * (window.__pumpMult||1);
    const gain = Math.round(base*m);
    state.score += gain; renderScore();
    popup(worldPos, "+"+gain, (window.__pumpMult||1)>1 ? MAG : (window.__mult()>1 ? GOLD : TEAL));
    const nw = 1 + Math.floor(state.score/150);
    if(nw>state.wave){ state.wave=nw; try{sfx.wave();}catch(_){}
      showBanner("WAVE "+state.wave);
    }
  };

  window.spawn = function(){
    const e=getEntity(), r=Math.random();
    if(r<CFG.powerupChance){
      e.type = Math.random()<0.5 ? TYPE.SHIELD : TYPE.BOMB;
      e.sprite.material = (e.type===TYPE.SHIELD)?myShieldMat:myBombMat; e.sprite.scale.set(2.3,2.3,1);
    } else if(r<CFG.powerupChance+CFG.holderChance){
      e.type=TYPE.HOLDER; e.sprite.material=myHolderMat; e.sprite.scale.set(2.7,2.7,1);
    } else {
      e.type=TYPE.SCAMMER; e.sprite.material=myScammerMats[(Math.random()*myScammerMats.length)|0]; e.sprite.scale.set(2.8,2.8,1);
    }
    e.hp=1; e.sprite.position.set((Math.random()*2-1)*playHalfWidth, 0.9, SPAWN_Z); e.prevZ=SPAWN_Z; active.push(e);
  };

  window.resolve = function(e){
    const p=e.sprite.position.clone();
    if(e.type===TYPE.SCAMMER){
      state.combo++; state.kills++; run.kills++; if(state.combo>run.combo) run.combo=state.combo;
      try{sfx.catch(state.combo);}catch(_){}
      burst(p.x,p.y,p.z,MAG,14); window.addScore(CFG.scammerPoints,p); renderCombo();
      const tok=Math.round(2*(window.__dropMult||1)); econ.tokens+=tok; run.earned+=tok; pop=1.22;  // DEGEN LUCK applies to smashed kills too, not just shot ones
      updateHUDtokens();
      if(state.combo>0 && state.combo%5===0){ showBanner(state.combo+" COMBO!"); flashColor("rgba(57,255,122,.35)",0.5); shake(0.5); }
      try{ if(tg&&tg.HapticFeedback) tg.HapticFeedback.impactOccurred("light"); }catch(_){}
    } else if(e.type===TYPE.HOLDER){
      if(shieldActive){ shieldActive=false; burst(p.x,p.y,p.z,TEAL,12); popup(p,"BLOCKED!",TEAL); try{sfx.power();}catch(_){} }
      else loseLife(p);
    } else if(e.type===TYPE.SHIELD){
      shieldActive=true; burst(p.x,p.y,p.z,TEAL,12); popup(p,"SHIELD!",TEAL); try{sfx.power();}catch(_){}
    } else if(e.type===TYPE.BOMB){
      try{sfx.power();}catch(_){} burst(p.x,p.y,p.z,GOLD,18); shake(0.7); flashColor("rgba(255,210,63,.4)",0.6); popup(p,"LIQUIDATED!",GOLD);
      for(let i=active.length-1;i>=0;i--){ const a=active[i]; if(a!==e&&a.type===TYPE.SCAMMER&&!a.dead){
        a.dead=true; const ap=a.sprite.position.clone(); burst(ap.x,ap.y,ap.z,MAG,6); state.kills++; run.kills++; window.addScore(CFG.scammerPoints,ap); freeEntity(a); } }
    }
    e.dead=true; freeEntity(e); updateHUDtokens();
  };

  /* ------------------------- per-frame world hook ------------------------- */
  window.__frame = function(dt){
    const sp=(state.running?state.speed:3.5)*dt;
    // pylons[] is intentionally empty (roadside cleared by the overhaul); only the
    // tower skyline recycles. Boss-flair loop removed with the Glitch Whale. (D1/D2)
    for(const b of skyline){ b.position.z+=sp; if(b.position.z>CAM.z+5) b.position.z-=SKY_SPAN; }
    floorTex.offset.y = (floorTex.offset.y - sp*0.012)%1;
    // shadow follows player
    try { shadow.position.x = player.position.x;
      shadow.material.opacity = 0.7 - (player.position.y-0.9)*0.5;   // D6: removed dead `const s` (was *0.0)
      shadow.scale.x = 3 - (player.position.y-0.9)*0.6; } catch(e){}
  };

  /* === ANCHOR: UI_PANELS === */
  /* ======================================================================== *
   *  UI: tabs, wallet, missions, leaderboard, skins, streak, share            *
   * ======================================================================== */
  const $ = id => document.getElementById(id);
  function toast(msg,color){
    const t=document.createElement("div"); t.className="xz-toast"; t.textContent=msg;
    if(color) t.style.color=color; document.body.appendChild(t);
    requestAnimationFrame(()=>t.classList.add("show"));
    setTimeout(()=>{ t.classList.remove("show"); setTimeout(()=>t.remove(),300); },1800);
  }
  window.__toast = toast;   // exposed so the real wallet flow in index.html can surface errors

  /* --------------------- cross-player leaderboard (optional) ---------------
   * Backed by the Cloudflare Worker in /worker. Enabled only when LEADERBOARD_API
   * is set in index.html; otherwise everything below no-ops and the local RANKS
   * board still works. */
  function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c =>
    ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c])); }
  function lbApi(){ const u = window.__LB_API || ""; return u ? u.replace(/\/+$/,"") : ""; }
  // Currently-linked Solana address, or "" when no wallet is connected.
  function connectedWallet(){ try{ return (window.XZWallet && window.XZWallet.address) || ""; }catch(_){ return ""; } }

  /* ========================= identity (Telegram OR web) =====================
   * Telegram players authenticate with initData exactly as before. Web players
   * sign in with their wallet or Google and get a session token, which rides in an
   * Authorization header. Both resolve to the same server-side player id, so both
   * land on the SAME leaderboard. */
  const AUTH_TOKEN_KEY = "xz_auth_v1";
  /* Persist the WHOLE identity, not just the token. Storing only the token meant name
   * and provider were null on every page load, and renderLoginCard needs both — so a
   * signed-in player saw the "sign in" card until /auth/me returned, and kept seeing it
   * if that request was slow or failed. The session was valid the entire time; only the
   * UI disagreed. Handles the legacy bare-string format written by earlier builds. */
  function loadAuth(){
    const v = store.get(AUTH_TOKEN_KEY, null);
    if(!v) return { token:null, pid:null, name:null, provider:null };
    if(typeof v === "string") return { token:v, pid:null, name:null, provider:null };
    return { token:v.token||null, pid:v.pid||null, name:v.name||null, provider:v.provider||null };
  }
  const auth = loadAuth();

  function tgInitData(){ try{ return (tg && tg.initData) || ""; }catch(_){ return ""; } }
  function signedIn(){ return !!(tgInitData() || auth.token); }
  // Headers for any authenticated call. Telegram rides in the body (initData), web in a
  // Bearer token — the Worker accepts either and doesn't care which.
  function authHeaders(){
    const h = { "content-type":"application/json" };
    if(auth.token) h["Authorization"] = "Bearer " + auth.token;
    return h;
  }
  // Per-run telemetry the Worker uses to bound a submitted score. Sending it is not
  // optional: a submit without it is rejected once the score is non-trivial.
  function runStats(){
    return { secs: Math.round(state.elapsed||0), kills: run.kills|0, boss: run.boss|0 };
  }
  function setAuth(d, provider){
    auth.token = d.token; auth.pid = d.pid; auth.name = d.name; auth.provider = provider;
    if(d.tag) setMyTag(d.tag);
    saveAuth();
  }
  function saveAuth(){
    store.set(AUTH_TOKEN_KEY, { token:auth.token, pid:auth.pid, name:auth.name, provider:auth.provider });
  }

  /* Which leaderboard row is MINE.
   * Matching on display name never worked for web players — outside Telegram tgName()
   * returns the literal "YOU", which matches nothing — and it actively mis-highlights
   * when two players share a name, which Google logins make common (it gives a first
   * name, not a unique handle). The server now stamps each row with a short one-way
   * hash of the player id, and tells us our own, so rows are matched on that instead. */
  let myTag = store.get("xz_mytag", null);
  function setMyTag(t){ if(t && t!==myTag){ myTag=t; store.set("xz_mytag", t); } }
  function isMe(entry){ return !!(myTag && entry && entry.tag === myTag); }

  /* Display name for a board row. The tag suffix is added ONLY when the same name
   * appears more than once in the visible list, so the common case stays clean. */
  function boardName(entry, dupeNames){
    const nm = escapeHtml(entry.name || "Player");
    const dup = dupeNames && dupeNames.has(entry.name) && entry.tag;
    return nm + (dup ? '<span class="ltag">#'+escapeHtml(entry.tag)+'</span>' : "");
  }
  function dupeNamesIn(list){
    const seen = new Map(), dup = new Set();
    for(const e of list){ const n=e && e.name; if(!n) continue;
      if(seen.has(n)) dup.add(n); else seen.set(n, 1); }
    return dup;
  }
  function clearAuth(){
    auth.token = auth.pid = auth.name = auth.provider = null;
    try{ localStorage.removeItem(AUTH_TOKEN_KEY); }catch(_){}
  }
  // Re-validate a stored token on boot; a rejected/expired one is dropped rather than
  // left to fail every subsequent submit silently.
  function refreshAuth(cb){
    const api = lbApi();
    if(!api || !auth.token){ if(cb) cb(false); return; }
    fetch(api+"/auth/me", { headers:{ "Authorization":"Bearer "+auth.token } })
      .then(r=>r.ok?r.json():null).then(d=>{
        if(d && d.ok){ auth.pid=d.pid; auth.name=d.name; auth.provider=d.provider; setMyTag(d.tag); saveAuth(); if(cb) cb(true); }
        else { clearAuth(); if(cb) cb(false); }
      }).catch(()=>{ if(cb) cb(false); });   // network blip: keep the token, try again later
  }

  /* Sign-In With Solana: the wallet signs a server nonce. No transaction, no gas —
   * it only proves key ownership, and it doubles as the holder-tier source. */
  async function loginWithWallet(){
    const api = lbApi(); if(!api){ toast("Backend not connected", RED); return false; }
    try{
      if(!(await ensureTurnstile())) return false;   // check the captcha BEFORE asking for a signature
      if(!window.XZWallet){ toast("Wallet connector loading — try again", GOLD); return false; }
      if(!connectedWallet()){
        const ok = await window.XZWallet.connect();
        if(!ok || !connectedWallet()){ return false; }   // connect() already surfaced why
      }
      if(!window.XZWallet.signMessage){ toast("This wallet can't sign in here — try a browser wallet", RED); return false; }
      const n = await fetch(api+"/auth/nonce",{cache:"no-store"}).then(r=>r.json());
      if(!n || !n.nonce){ toast("Login unavailable right now", RED); return false; }
      const sig = await window.XZWallet.signMessage(n.message);
      if(!sig){ return false; }                          // user rejected the signature
      const res = await fetch(api+"/auth/wallet",{ method:"POST", headers:{"content-type":"application/json"},
        body: JSON.stringify({ address: connectedWallet(), nonce: n.nonce, signature: sig, turnstile: window.__turnstileToken||"" }) })
        .then(r=>r.json());
      if(!res || !res.ok){ toast("Sign-in failed: "+((res&&res.error)||"unknown"), RED); return false; }
      setAuth(res, "wallet");
      toast("Signed in as "+res.name+" 🦖", TEAL);
      onAuthChanged();
      return true;
    }catch(e){ toast("Sign-in failed", RED); return false; }
    finally{ resetTurnstile(); }   // tokens are single-use — never resend a spent one
  }

  /* Discord — Authorization Code grant. The exchange needs the client secret, so the
   * game never sees it: we open the Worker's /auth/discord/start, Discord bounces the
   * player to /auth/discord/callback, and the Worker parks the finished session in KV
   * under our sid. We poll for it. That is the same bridge the Phantom connect uses,
   * and it keeps the session token out of the URL — it is a bearer credential, and a
   * query string ends up in history, Referer headers and any analytics on the page. */
  /* What the Worker can actually offer. Asked once and cached: the sheet uses it to
   * show only the tiles that can work, rather than one that fails after the click. */
  let _providers = null;
  async function providers(){
    if(_providers) return _providers;
    const api = lbApi(); if(!api) return (_providers = {});
    try{ _providers = (await fetch(api+"/auth/providers",{cache:"no-store"}).then(r=>r.json())) || {}; }
    catch(_){ _providers = {}; }
    return _providers;
  }

  let _discordPoll = null;
  async function loginWithDiscord(){
    const api = lbApi(); if(!api){ toast("Backend not connected", RED); return false; }
    const sid = [...crypto.getRandomValues(new Uint8Array(16))].map(b=>b.toString(16).padStart(2,"0")).join("");
    // Open the window inside the click gesture, or the popup blocker eats it.
    const w = window.open(api+"/auth/discord/start?sid="+sid, "_blank");
    if(!w){ toast("Allow pop-ups to sign in with Discord", GOLD); return false; }
    toast("Finish in the Discord tab…", CYAN);

    clearInterval(_discordPoll);
    const started = Date.now();
    return await new Promise(resolve => {
      _discordPoll = setInterval(async () => {
        if(Date.now() - started > 180000){          // give up after 3 min
          clearInterval(_discordPoll); toast("Discord sign-in timed out", RED); resolve(false); return;
        }
        let r=null;
        try{ r = await fetch(api+"/auth/discord/result?sid="+sid,{cache:"no-store"}).then(r=>r.json()); }catch(_){ return; }
        if(!r || !r.ready) return;                  // still waiting
        clearInterval(_discordPoll);
        if(!r.ok || !r.token){ toast("Discord sign-in failed", RED); resolve(false); return; }
        setAuth(r, "discord");
        toast("Signed in as "+r.name+" 🦖", TEAL);
        onAuthChanged();
        resolve(true);
      }, 1500);
    });
  }

  /* Google — the ID token is verified server-side against Google's keys. */
  async function loginWithGoogle(credential){
    const api = lbApi(); if(!api) return false;
    try{
      if(!(await ensureTurnstile())) return false;
      const res = await fetch(api+"/auth/google",{ method:"POST", headers:{"content-type":"application/json"},
        body: JSON.stringify({ credential, turnstile: window.__turnstileToken||"" }) }).then(r=>r.json());
      if(!res || !res.ok){ toast("Google sign-in failed: "+((res&&res.error)||"unknown"), RED); return false; }
      setAuth(res, "google");
      toast("Signed in as "+res.name+" 🦖", TEAL);
      onAuthChanged();
      return true;
    }catch(e){ toast("Google sign-in failed", RED); return false; }
    finally{ resetTurnstile(); }
  }
  // Google Identity Services calls this from its own callback.
  window.__xzGoogleCredential = c => loginWithGoogle(c && c.credential);

  /* Telegram (web players) — the Login Widget, not initData. telegram-widget.js is
   * loaded LAZILY and only out here on the web, for two reasons: inside the Mini App
   * this whole card is hidden anyway, and the widget script also claims the global
   * `window.Telegram` — so WebApp is snapshotted and put back if it gets clobbered.
   * Requires the site's domain to be registered with @BotFather via /setdomain;
   * without that oauth.telegram.org rejects the popup with "Bot domain invalid". */
  let _tgWidget = null;
  function tgLoginReady(){ try{ return !!(window.Telegram && window.Telegram.Login && window.Telegram.Login.auth); }catch(_){ return false; } }
  function loadTelegramWidget(){
    if(tgLoginReady()) return Promise.resolve(true);
    if(_tgWidget) return _tgWidget;
    _tgWidget = new Promise(resolve => {
      const webApp = (window.Telegram && window.Telegram.WebApp) || null;
      const s = document.createElement("script");
      s.src = "https://telegram.org/js/telegram-widget.js?22"; s.async = true;
      s.onload = () => {
        if(webApp && window.Telegram && !window.Telegram.WebApp) window.Telegram.WebApp = webApp;
        resolve(tgLoginReady());
      };
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });
    return _tgWidget;
  }
  async function loginWithTelegram(botId){
    const api = lbApi(); if(!api || !botId){ toast("Backend not connected", RED); return false; }
    if(!(await loadTelegramWidget())){ toast("Telegram login unavailable right now", RED); return false; }
    // auth() opens a popup, so it must stay inside the click's activation window —
    // nothing slow (Turnstile wait, network) may run before this line. The widget only
    // watches for the popup to close, so a BLOCKED popup never calls back at all: the
    // timeout is what stops the tile sitting disabled forever in that case.
    const data = await new Promise(resolve => {
      let done = false;
      const finish = u => { if(!done){ done = true; resolve(u || null); } };
      const timer = setTimeout(() => { if(!done){ toast("Allow pop-ups to sign in with Telegram", GOLD); finish(null); } }, 180000);
      try{ window.Telegram.Login.auth({ bot_id:parseInt(botId,10), request_access:false }, u => { clearTimeout(timer); finish(u); }); }
      catch(_){ clearTimeout(timer); finish(null); }
    });
    if(!data || !data.hash){ toast("Telegram sign-in cancelled", GOLD); return false; }
    try{
      if(!(await ensureTurnstile())) return false;
      const res = await fetch(api+"/auth/telegram",{ method:"POST", headers:{"content-type":"application/json"},
        body: JSON.stringify({ user:data, turnstile: window.__turnstileToken||"" }) }).then(r=>r.json());
      if(!res || !res.ok){ toast("Telegram sign-in failed: "+((res&&res.error)||"unknown"), RED); return false; }
      setAuth(res, "tg");         // "tg" — the SAME provider the Mini App resolves to
      toast("Signed in as "+res.name+" 🦖", TEAL);
      onAuthChanged();
      return true;
    }catch(e){ toast("Telegram sign-in failed", RED); return false; }
    finally{ resetTurnstile(); }
  }
  // The server calls the provider "tg"; players call it Telegram.
  function providerLabel(p){ return p === "tg" ? "telegram" : (p || ""); }

  /* Start-screen sign-in card. Hidden entirely inside Telegram (initData already
   * identifies the player) and while signed in on web. Guests are never blocked from
   * playing — this only appears as the route to POSTING a score. */
  function renderLoginCard(){
    const host = $("loginCard"); if(!host) return;
    if(tgInitData()){ host.style.display="none"; return; }          // Telegram: nothing to do
    if(!lbApi()){ host.style.display="none"; return; }
    host.style.display="";
    if(auth.token && auth.name){
      closeLoginPanel();            // just signed in — get the sheet out of the way
      host.innerHTML =
        '<div class="cardTop"><span class="loginHead">✔ SIGNED IN</span>'+
          '<span class="loginSub dim">scores post to the board</span></div>'+
        '<div class="loginWho">'+escapeHtml(auth.name)+'<span> · '+escapeHtml(providerLabel(auth.provider))+'</span></div>'+
        '<button class="btn secondary small" id="loginOut">SIGN OUT</button>';
      $("loginOut").onclick = logout;
      return;
    }
    // Signed out: the card is now just a trigger. The options themselves (wallet button,
    // Google button, Turnstile widget) are ~150px of controls before a word of text, so
    // inline they dominated the start screen; they live in #loginPanel instead.
    host.innerHTML =
      '<div class="cardTop"><span class="loginHead">🔐 SIGN IN TO RANK</span>'+
        '<span class="loginSub dim">optional</span></div>'+
      '<button class="btn wallet-login" id="loginOpen">◆ SIGN IN</button>'+
      // Keep the multiplier discoverable from the start screen now that the wallet button
      // has moved into the sheet — otherwise the reward is buried behind a click.
      '<div class="loginSub dim">Post scores to the board · wallet login pays up to <b class="gold">×2 score</b></div>';
    $("loginOpen").onclick = openLoginPanel;
  }

  /* The sign-in sheet. Rebuilt on every open rather than once, because Turnstile tokens
   * are single-use and expire (~300s) — a widget mounted at page load and left sitting
   * behind a closed panel would hand back a stale token. mountTurnstile() already drops
   * the previous widget id, so re-rendering here is the intended path. */
  /* Provider marks. Brand glyphs, drawn inline so the sheet needs no image requests
   * and each one inherits the tile's colour. */
  const ICON_WALLET =
    '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">'+
    '<path fill="currentColor" d="M3 7a3 3 0 0 1 3-3h11a2 2 0 0 1 0 4H6a3 3 0 0 0-3 3V7Zm0 4.5A2.5 2.5 0 0 1 5.5 9H19a2 2 0 0 1 2 2v6a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-5.5ZM16.5 15.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"/></svg>';
  const ICON_DISCORD =
    '<svg viewBox="0 0 24 18" width="27" height="20" aria-hidden="true">'+
    '<path fill="currentColor" d="M20.3 1.5A19.8 19.8 0 0 0 15.4 0l-.25.5a18.3 18.3 0 0 1 4.3 1.4A17.6 17.6 0 0 0 12 .8a17.6 17.6 0 0 0-7.45 1.1A18.3 18.3 0 0 1 8.85.5L8.6 0A19.8 19.8 0 0 0 3.7 1.5C.6 6.1-.25 10.6.17 15a19.9 19.9 0 0 0 6.05 3l.8-1.35a13 13 0 0 1-2-1l.4-.3a14.2 14.2 0 0 0 12.16 0l.4.3a13 13 0 0 1-2 1L16.8 18a19.9 19.9 0 0 0 6.05-3c.5-5.1-.85-9.55-2.55-13.5ZM8.02 12.3c-1.18 0-2.15-1.08-2.15-2.4S6.82 7.5 8.02 7.5s2.17 1.08 2.15 2.4c0 1.32-.95 2.4-2.15 2.4Zm7.96 0c-1.18 0-2.15-1.08-2.15-2.4s.95-2.4 2.15-2.4 2.17 1.08 2.15 2.4c0 1.32-.95 2.4-2.15 2.4Z"/></svg>';
  // Telegram's official roundel rather than a monochrome glyph: this is the mark players
  // recognise, and the brand blue reads instantly in a grid of four options. Gradient id is
  // namespaced (xzTgG) because this SVG is injected into the live DOM alongside other inline
  // SVGs — a bare id like "a" would be a collision waiting to happen.
  const ICON_TELEGRAM =
    '<svg viewBox="0 0 240 240" width="26" height="26" aria-hidden="true">'+
    '<defs><linearGradient id="xzTgG" x1="120" y1="0" x2="120" y2="240" gradientUnits="userSpaceOnUse">'+
    '<stop offset="0" stop-color="#2aabee"/><stop offset="1" stop-color="#229ed9"/></linearGradient></defs>'+
    '<circle cx="120" cy="120" r="120" fill="url(#xzTgG)"/>'+
    '<path fill="#fff" d="M54.3 118.8c35-15.2 58.3-25.3 70-30.2 33.3-13.9 40.3-16.3 44.8-16.4 1 0 3.2.2 4.7 1.4 1.2 1 1.5 2.3 1.7 3.3.2 1 .4 3.1.2 4.8-1.8 19-9.6 65.1-13.6 86.4-1.7 9-5 12-8.2 12.3-7 .6-12.3-4.6-19-9-10.6-6.9-16.5-11.2-26.8-18-11.9-7.8-4.2-12.1 2.6-19.1 1.8-1.8 32.6-29.9 33.2-32.4.1-.3.1-1.5-.6-2.1-.7-.6-1.7-.4-2.5-.2-1.1.2-18 11.4-50.8 33.6-4.8 3.3-9.2 4.9-13.1 4.8-4.3-.1-12.6-2.4-18.8-4.4-7.6-2.5-13.6-3.8-13.1-8 .3-2.2 3.3-4.4 9.3-6.8Z"/></svg>';

  function renderLoginPanel(){
    const host = $("loginInner"); if(!host) return;
    // Tile markup. Everything starts hidden and /auth/providers reveals what works —
    // an option that always fails is worse than no option.
    const tile = (id, cls, icon, label, badge) =>
      '<button class="ltile '+cls+'" id="'+id+'" style="display:none">'+
        (badge ? '<span class="lbadge">'+badge+'</span>' : '')+
        '<span class="lico">'+icon+'</span><span class="llab">'+label+'</span></button>';
    host.innerHTML =
      '<h2 class="pnl-title">SIGN IN TO RANK</h2>'+
      '<div class="loginSub" style="text-align:left">Guests can always play — signing in only posts your scores to the global leaderboard. Pick one:</div>'+
      '<div class="loginGrid">'+
        tile("loginWallet",   "tl-wallet",   ICON_WALLET,   "WALLET",   "×2")+
        tile("loginDiscord",  "tl-discord",  ICON_DISCORD,  "DISCORD")+
        tile("loginTelegram", "tl-telegram", ICON_TELEGRAM, "TELEGRAM")+
        // Google renders its OWN button (its terms require it), so its tile is a frame
        // around the real GIS icon button rather than one of ours.
        '<div class="ltile tl-google" id="loginGoogle" style="display:none">'+
          '<span class="lico"><span id="gsiButton"></span></span><span class="llab">GOOGLE</span></div>'+
      '</div>'+
      // ONE wallet route. The same connect that signs you in also reads your $XZILLA
      // balance (XZWallet.onChange -> applyWalletToEcon), so an empty wallet is a perfectly
      // good login and a funded one additionally sets the holder tier. Saying so removes
      // the old worry that "connect wallet" was about to cost something.
      '<div class="loginPerk">Empty wallet? Still works. Holding $XZILLA also sets your score multiplier — up to ×2</div>'+
      '<div class="loginSub dim">Free signature · no transaction · nothing leaves your wallet</div>'+
      (turnstileEnabled() ? '<div id="tsWidget" class="tsWidget"></div>' : '')+
      '<button class="btn secondary small pbtn" id="loginCancel">CLOSE</button>';
    $("loginCancel").onclick = closeLoginPanel;
    mountTurnstile();

    // One handler shape for every tile: disable while the flow runs so a second tap
    // can't open two popups.
    const wire = (id, run) => {
      const b = $(id); if(!b) return;
      b.style.display = "";
      b.onclick = async (ev) => {
        const t = ev.currentTarget; t.classList.add("busy"); t.disabled = true;
        try{ await run(); } finally { if(t.isConnected){ t.disabled = false; t.classList.remove("busy"); } }
      };
    };
    providers().then(p => {
      if(!$("loginWallet")) return;                      // sheet closed while we asked
      if(p.wallet !== false) wire("loginWallet", loginWithWallet);
      if(p.discord)          wire("loginDiscord", loginWithDiscord);
      if(p.telegram){
        loadTelegramWidget();                            // preload, so the click can pop straight up
        wire("loginTelegram", () => loginWithTelegram(p.telegram));
      }
      if(window.__GOOGLE_CLIENT_ID && p.google !== false){
        const g = $("loginGoogle"); if(g) g.style.display = "";
        mountGoogleButton();
      }
    });
  }
  function openLoginPanel(){ const p=$("loginPanel"); if(!p) return; renderLoginPanel(); p.classList.remove("hidden"); }
  function closeLoginPanel(){ const p=$("loginPanel"); if(p) p.classList.add("hidden"); }
  { const p=$("loginPanel"); if(p) p.addEventListener("click", e=>{ if(e.target===p) closeLoginPanel(); }); }

  /* Google Identity Services renders its own button; it must be re-rendered every time
   * the card is rebuilt, and the library may still be loading on first paint. */
  /* ------------------------------- Turnstile -------------------------------
   * Bot gate on the sign-in paths. Two properties drive the design:
   *   - a token is SINGLE USE, and
   *   - it expires ~300s after issue.
   * So the token cannot simply be captured once and reused: it is reset after every
   * login attempt (success or failure) and re-issued when it expires, otherwise a
   * player who leaves the menu open and then signs in gets a confusing rejection.
   *
   * Both halves are independently switchable: no sitekey here means no widget, and
   * no TURNSTILE_SECRET on the Worker means verification is skipped. Neither state
   * is broken, which is what makes it safe to roll out in two steps. */
  let _tsWidgetId = null;
  window.__turnstileToken = "";
  function turnstileEnabled(){ return !!window.__TURNSTILE_SITEKEY; }

  function mountTurnstile(){
    if(!turnstileEnabled()) return;
    const el = $("tsWidget"); if(!el) return;
    const ts = window.turnstile;
    if(!ts){ setTimeout(mountTurnstile, 600); return; }        // library still loading
    // The card is rebuilt on every auth change, so the previous widget id is stale.
    if(_tsWidgetId !== null){ try{ ts.remove(_tsWidgetId); }catch(_){} _tsWidgetId = null; }
    try{
      _tsWidgetId = ts.render(el, {
        sitekey: window.__TURNSTILE_SITEKEY,
        action: "turnstile-spin-v1",
        theme: "dark",
        size: "flexible",
        callback: t => { window.__turnstileToken = t || ""; },
        "expired-callback": () => { window.__turnstileToken = ""; resetTurnstile(); },
        "error-callback": () => { window.__turnstileToken = ""; },
      });
    }catch(_){}
  }
  /* Make sure a captcha token exists BEFORE doing any login work.
   * Managed mode usually self-completes in a second or two, but it can present an
   * interactive check. Without this the player would connect their wallet and sign a
   * message, and only then be rejected with a bare "captcha_failed" — burning the most
   * annoying step of the flow for nothing. Waits briefly, then explains what to do. */
  async function ensureTurnstile(){
    if(!turnstileEnabled()) return true;
    for(let i=0; i<16 && !window.__turnstileToken; i++) await new Promise(r=>setTimeout(r,250));
    if(window.__turnstileToken) return true;
    toast("Tick “Verify you are human” first, then sign in", GOLD);
    return false;
  }

  // Burn the used token and request a fresh one. Called after every login attempt.
  function resetTurnstile(){
    window.__turnstileToken = "";
    if(_tsWidgetId === null || !window.turnstile) return;
    try{ window.turnstile.reset(_tsWidgetId); }catch(_){}
  }

  let _gsiInited = false;
  function mountGoogleButton(){
    const el = $("gsiButton");
    if(!el || !window.__GOOGLE_CLIENT_ID) return;
    const g = window.google && window.google.accounts && window.google.accounts.id;
    if(!g){ setTimeout(mountGoogleButton, 600); return; }   // library still loading
    try{
      // initialize() is global and must run ONCE — calling it again on every re-mount
      // makes GIS warn that only the last instance survives. renderButton is the part
      // that genuinely needs repeating whenever the card is rebuilt.
      if(!_gsiInited){
        g.initialize({ client_id: window.__GOOGLE_CLIENT_ID, callback: window.__xzGoogleCredential });
        _gsiInited = true;
      }
      // Icon-only, to sit in the provider grid next to the wallet/Discord/Telegram tiles.
      // GIS must render its own button — this is the closest it offers to a plain icon.
      g.renderButton(el, { type:"icon", theme:"filled_black", size:"large", shape:"circle" });
    }catch(_){}
  }

  function logout(){ clearAuth(); toast("Signed out", CYAN); onAuthChanged(); }
  function onAuthChanged(){
    try{ renderLoginCard(); }catch(_){}
    // The daily attempt belongs to the account, so a change of identity re-opens or
    // re-locks today's run. Without this, switching accounts kept the previous lock.
    try{ if(window.__refreshDailyStatus) window.__refreshDailyStatus(); }catch(_){}
    try{ if(!$("leaderboardPanel").classList.contains("hidden")) renderLeaderboard(); }catch(_){}
  }
  window.__xzAuth = { get token(){ return auth.token; }, get name(){ return auth.name; },
                      get pid(){ return auth.pid; }, signedIn, loginWithWallet, logout };

  function submitLeaderboard(){
    const api = lbApi(); if(!api) return;
    if(!signedIn()) return;                          // guests play freely; posting needs an identity
    // SEASONAL RESET: post ONLY the score earned in THIS run — never the persisted all-time
    // best (state.best / myBest). Those live on each player's device+account and survive a
    // server KV wipe, so submitting them re-posts pre-reset scores and refills the board within
    // a day. Run-score-only means a wipe of lb:v1 stays clean: the board rebuilds purely from
    // runs played AFTER the reset. The Worker still keeps each user's MAX across runs, so a
    // player's standing is their best post-reset run (a true fresh season, repeatable on demand).
    const score = Math.round(state.score||0);
    if(score<=0) return;
    try{
      fetch(api + "/submit", { method:"POST", headers: authHeaders(),
        // wallet is a CLAIM, not proof — the Worker re-reads the balance on-chain before
        // it stamps a tier, so sending someone else's address just badges them, not you.
        // stats is REQUIRED: the Worker bounds the score by what the run could plausibly
        // have produced, and a submit without it is rejected once the score is non-trivial.
        body: JSON.stringify({ initData: tgInitData(), score, wallet: connectedWallet(), stats: runStats() }) })
        .then(r=>r.json()).then(d=>{
          if(d) setMyTag(d.you);   // Telegram players never call /auth/me — this is where they learn their tag
          const el=document.getElementById("goWorldRank"); if(!el) return;
          if(d && d.rank){ el.textContent="🌍 GLOBAL RANK #"+d.rank; el.style.color=GOLD; }
          else el.textContent="";
        }).catch(()=>{ const el=document.getElementById("goWorldRank"); if(el) el.textContent=""; });
    }catch(_){}
  }
  // Nicely-formatted score share that also links the bot so friends can tap & play.
  function shareScore(){
    const best  = Math.max(Math.round(state.best||0), (myBest&&myBest.score)||0, Math.round(state.score||0));
    const t     = titleForScore(best);
    const title = t ? t.name : "ROOKIE";
    const link  = refLink();   // referral-attributed so friends who join from a shared score count too
    const txt   = "🦖 I smashed "+fmt(best)+" pts as "+title+" in XZILLA: RUG SMASHER!\nThink you can beat my rank? 👇";
    try{
      if(tg && tg.openTelegramLink){
        tg.openTelegramLink("https://t.me/share/url?url="+encodeURIComponent(link)+"&text="+encodeURIComponent(txt));
        return;
      }
    }catch(_){}
    const full = txt + (link ? ("\n"+link) : "");
    try{ navigator.clipboard.writeText(full); toast("Copied — paste anywhere to share!",CYAN); }catch(_){ toast(full); }
  }

  // Post the live TOP 10 to a Telegram chat/group (native share sheet) or to X (tweet
  // intent). Pulls the freshest board from the Worker so what you post is current.
  function postLeaderboard(target){
    const api = (typeof lbApi==="function") ? lbApi() : "";
    if(!api){ toast("Leaderboard backend not connected",RED); return; }
    const link = refLink();   // referral-attributed link
    toast("Fetching leaderboard…",CYAN);
    fetch(api+"/top",{cache:"no-store"}).then(r=>r.json()).then(d=>{
      const list=(d&&d.top)||[];
      if(!list.length){ toast("No scores yet to post",RED); return; }
      if(target==="x"){
        // X caps tweets at 280 chars — keep it compact (top 5) so text+link fits.
        // Strip the leading "@" (Telegram handle) so X doesn't read it as an X mention.
        const rows=list.slice(0,5).map((e,i)=>(i+1)+". "+String(e.name||"").replace(/^@+/,"")+" — "+fmt(e.score)).join("\n");
        const text="🦖 XZILLA: RUG SMASHER — top degens:\n"+rows+"\n\nSmash scams, climb the board 👉";
        const url="https://twitter.com/intent/tweet?text="+encodeURIComponent(text)+(link?("&url="+encodeURIComponent(link)):"");
        try{ if(tg&&tg.openLink) tg.openLink(url); else window.open(url,"_blank"); }catch(_){ try{ window.open(url,"_blank"); }catch(e){ toast("Couldn't open X",RED); } }
      } else {
        const medal=i=>i===0?"🥇":i===1?"🥈":i===2?"🥉":"#"+(i+1);
        const rows=list.slice(0,10).map((e,i)=>medal(i)+" "+e.name+" — "+fmt(e.score)).join("\n");
        const text="🦖 XZILLA: RUG SMASHER\nTOP 10 DEGENS\n\n"+rows+"\n\nThink you can crack the top 10? 👇";
        const shareUrl="https://t.me/share/url?url="+encodeURIComponent(link)+"&text="+encodeURIComponent(text);
        try{
          if(tg&&tg.openTelegramLink){ tg.openTelegramLink(shareUrl); }
          else { navigator.clipboard.writeText(text+(link?("\n"+link):"")); toast("Leaderboard copied — paste in your group",CYAN); }
        }catch(_){ toast("Share unavailable",RED); }
      }
    }).catch(()=>toast("Couldn't load leaderboard",RED));
  }
  function updateHUDtokens(){ const b=$("bagHud"); if(b) b.textContent=abbr(econ.tokens); }
  function updateVip(){
    // VIP if the simulated holdings tier grants a multiplier OR a real on-chain
    // $XZILLA holding was verified by the wallet flow (window.__holderVerified).
    // The OR keeps a verified holder's VIP from being wiped when beforeRun() calls
    // this with empty simulated holdings.
    const t=tierFor(econ.holdings); const holder=!!window.__holderVerified;
    state.vip = t.m>1 || holder;
    try{ el.vipBadge.style.display = state.vip ? "inline-block" : "none";
      el.vipBadge.textContent = t.m>1 ? ("★ "+t.l+" · "+t.m+"x") : "★ $XZILLA HOLDER"; }catch(e){}
  }

  const PANELS = {WALLET:"walletPanel", MISSIONS:"missionsPanel", LEADERBOARD:"leaderboardPanel", SKINS:"skinsPanel"};
  function hideAllOverlays(){
    $("startScreen").classList.add("hidden");
    const ps=$("pauseScreen"); if(ps) ps.classList.add("hidden");
    Object.values(PANELS).forEach(id=>$(id).classList.add("hidden"));
  }
  function showTab(name){
    document.querySelectorAll("#tabbar .tab").forEach(b=>b.classList.toggle("on", b.dataset.tab===name));
    hideAllOverlays(); $("gameOverScreen").classList.add("hidden");
    if(name==="PLAY"){
      // While a run is paused, PLAY returns to the PAUSE menu (RESUME/QUIT) instead of the
      // start screen, so the run is still resumable and no overlay/menu is left behind.
      let paused=false; try{ paused=!!isPaused; }catch(e){}
      if(paused){ $("pauseScreen").classList.remove("hidden"); }
      else { $("startScreen").classList.remove("hidden"); applySkin(); }   // reflect equipped skin on the menu player
    }
    else { $(PANELS[name]).classList.remove("hidden"); renderPanel(name); }
  }
  function renderPanel(name){
    if(name==="WALLET") renderWallet();
    else if(name==="MISSIONS") renderMissions();
    else if(name==="LEADERBOARD") renderLeaderboard();
    else if(name==="SKINS") renderSkins();
  }

  function renderWallet(){
    const t=tierFor(econ.holdings);
    const tierLabel = mn => mn>=1e6 ? (mn/1e6)+"M+" : mn>=1e3 ? (mn/1e3)+"K+" : "&lt; 1M";
    const addr = (window.XZWallet && window.XZWallet.address) || null;
    const shortAddr = addr ? (addr.slice(0,4)+"…"+addr.slice(-4)) : "";
    $("walletInner").innerHTML =
      '<h2 class="pnl-title" style="border-color:'+MAG+'">SOLANA WALLET</h2>'+
      '<div class="wcard">'+
        '<div class="wrow"><span>$XZILLA HELD</span><b>'+fmt(econ.holdings)+'</b></div>'+
        '<div class="wrow"><span>XP MULTIPLIER</span><b style="color:'+t.c+';font-size:22px">'+t.m+'x</b></div>'+
        '<div class="tierbadge" style="border-color:'+t.c+';color:'+t.c+'">'+t.l+'</div>'+
      '</div>'+
      (addr
        ? '<div class="wrow" style="justify-content:center;color:'+TEAL+';margin:4px 0 8px;">✓ CONNECTED · '+shortAddr+'</div>'+
          '<button class="btn pbtn" id="wConnect">REFRESH BALANCE</button>'+
          '<button class="btn secondary small" id="wDisconnect" style="margin-top:8px">DISCONNECT WALLET</button>'+
          '<div class="sub">Tier set from your saved on-chain $XZILLA — you don\'t need to stay connected while playing. Refresh after buying more.</div>'
        : '<button class="btn pbtn" id="wConnect">CONNECT WALLET</button>'+
          '<div class="sub">Connect to verify your on-chain $XZILLA — your real balance sets the tier.</div>')+
      '<div class="ttable">'+ TIERS.map(r=>
        '<div class="trow'+(t.m===r.m?' on':'')+'"><span style="color:'+r.c+'">'+r.l+' · '+tierLabel(r.min)+'</span><b>'+r.m.toFixed(1)+'x</b></div>').join("")+
      '</div>';
    // When connected, the button re-reads the balance; otherwise it opens the connect flow.
    $("wConnect").onclick = addr
      ? (async ()=>{ toast("Refreshing $XZILLA…",CYAN); await window.XZWallet.refresh(); })
      : walletConnect;
    if(addr && $("wDisconnect")) $("wDisconnect").onclick = ()=>{ if(window.XZWallet) window.XZWallet.disconnect(); };
  }
  // Wallet connect routes through the shared window.XZWallet (Reown AppKit). The
  // verified balance flows back via applyWalletToEcon(), which sets the holder tier.
  function walletConnect(){
    if(window.XZWallet){ toast("Opening wallet…",CYAN); window.XZWallet.connect(); return; }
    toast("Wallet connector still loading — try again",RED);
  }
  // Apply a verified $XZILLA balance to the live holder tier + persist it.
  function applyWalletToEcon(address, balance){
    if(address && typeof balance==="number"){
      econ.holdings = Math.round(balance); window.__holderVerified = balance>0;
      saveEcon(); updateVip(); updateHUDtokens();
      if(!$("walletPanel").classList.contains("hidden")) renderWallet();
      toast(balance>0 ? ("Verified — "+fmt(balance)+" $XZILLA") : "Connected — no $XZILLA found", balance>0?GOLD:RED);
    } else if(!address){
      // disconnected → KEEP the last-verified tier (user preference). Just unlink the live
      // session: re-render the panel so the button reverts to CONNECT; the held amount and
      // multiplier are preserved (re-verify any time by reconnecting + REFRESH BALANCE).
      if(!$("walletPanel").classList.contains("hidden")) renderWallet();
      toast("Wallet disconnected — your tier is kept",CYAN);
    }
  }
  (function wireEconWallet(){
    if(window.XZWallet){ window.XZWallet.onChange(applyWalletToEcon); }
    else setTimeout(wireEconWallet, 150);
  })();

  function renderMissions(){
    ensureDaily(); ensureWeekly();
    const dpct=Math.min(100,(daily.prog/daily.goal)*100);
    const dailyHtml =
      '<h2 class="pnl-title" style="border-color:'+GOLD+'">DAILY CHALLENGE</h2>'+
      '<div class="dailyTop">🔥 STREAK <b>'+(econ.streak||0)+' day'+((econ.streak||0)===1?'':'s')+'</b></div>'+
      '<div class="mrow'+(daily.done?' done':'')+'" style="border-color:'+(daily.done?TEAL:GOLD)+'">'+
        '<div class="mtop"><span>'+daily.text+'</span><b style="color:'+(daily.done?TEAL:GOLD)+'">+'+fmt(daily.reward)+' XP'+(daily.done?' ✓':'')+'</b></div>'+
        '<div class="mbar"><i style="width:'+dpct+'%;background:'+(daily.done?TEAL:GOLD)+'"></i></div>'+
        '<div class="msub">'+fmt(Math.min(daily.prog,daily.goal))+' / '+fmt(daily.goal)+' · '+(daily.done?'claimed · ':'')+'resets daily</div></div>';
    const wpct=Math.min(100,(weekly.prog/weekly.goal)*100);
    const weeklyHtml =
      '<h2 class="pnl-title" style="border-color:'+MAG+';margin-top:16px;">WEEKLY CHALLENGE</h2>'+
      '<div class="mrow'+(weekly.done?' done':'')+'" style="border-color:'+(weekly.done?TEAL:MAG)+'">'+
        '<div class="mtop"><span>'+weekly.text+'</span><b style="color:'+(weekly.done?TEAL:MAG)+'">+'+fmt(weekly.reward)+' XP'+(weekly.done?' ✓':'')+'</b></div>'+
        '<div class="mbar"><i style="width:'+wpct+'%;background:'+(weekly.done?TEAL:MAG)+'"></i></div>'+
        '<div class="msub">'+fmt(Math.min(weekly.prog,weekly.goal))+' / '+fmt(weekly.goal)+' · '+(weekly.done?'claimed · ':'')+'resets weekly</div></div>';
    $("missionsInner").innerHTML =
      dailyHtml + weeklyHtml +
      '<h2 class="pnl-title" style="border-color:'+TEAL+';margin-top:16px;">BOUNTIES</h2>'+
      missions.map(m=>{
        const pct=Math.min(100,(m.prog/m.goal)*100);
        return '<div class="mrow'+(m.done?' done':'')+'">'+
          '<div class="mtop"><span>'+m.text+'</span><b style="color:'+(m.done?TEAL:GOLD)+'">+'+fmt(m.reward)+' XP'+(m.done?' ✓':'')+'</b></div>'+
          '<div class="mbar"><i style="width:'+pct+'%;background:'+(m.done?TEAL:MAG)+'"></i></div>'+
          '<div class="msub">'+fmt(Math.min(m.prog,m.goal))+' / '+fmt(m.goal)+(m.done?' · claimed':'')+'</div></div>';
      }).join("");
  }
  function renderLeaderboard(){
    const best = state.best||0;
    let cur=null, next=null;                              // current + next milestone vs the player's best
    for(const t of SCORE_TITLES){
      if(best>=t.score && (!cur  || t.score>cur.score))  cur=t;
      if(t.score>best && (!next || t.score<next.score))  next=t;
    }
    const floor = cur ? cur.score : 0;
    const progPct = next ? Math.max(0, Math.min(100, ((best-floor)/(next.score-floor))*100)) : 100;
    const curColor = rankColor(cur);          // band the player is standing in (grey when unranked)
    $("leaderboardInner").innerHTML =
      '<h2 class="pnl-title" style="border-color:'+GOLD+';margin-top:4px;">RANK MILESTONES</h2>'+
      '<div class="wcard" style="margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;">'+
        '<span class="hud-label">\u26a1 YOUR XP</span><b style="color:'+TEAL+';font-size:22px">'+fmt(econ.tokens)+'</b></div>'+
      '<div class="sub" style="margin-bottom:4px;">Best score: '+fmt(best)+' pts \u00b7 <span style="color:'+curColor+';font-weight:900">'+(cur?cur.name:"UNRANKED")+'</span></div>'+
      // Band strip: the whole five-colour ramp at a glance, the one you are standing in
      // lit and the rest knocked back. Without it the bands stay invisible until you have
      // actually climbed them, which is the state most players are in.
      '<div style="display:flex;gap:4px;align-items:center;margin-bottom:8px;">'+
        RANK_BANDS.map(b=>{
          const on = b.c===curColor;
          return '<i style="flex:1;border-radius:3px;background:'+b.c+';height:'+(on?"9px":"5px")+';'+
            'opacity:'+(on?"1":".3")+';'+(on?"box-shadow:0 0 10px "+b.c+";":"")+'"></i>';
        }).join("")+
      '</div>'+
      (function(){
        // Every row wears its band colour whether or not it is reached: reached rows are
        // filled and lit, unreached ones keep a dim edge stripe so the ramp still reads.
        // A gap opens wherever the colour changes, which is what makes the pairs group.
        let prev=null;
        return SCORE_TITLES.map(t=>{
          const reached = best>=t.score, col = t.c;
          const bandStart = col!==prev; prev = col;
          // 8-digit hex alpha: 26 ~ 15% fill, 40 ~ 25% glow, 4d ~ 30% edge when unreached.
          const style = (bandStart?'margin-top:7px;':'')+
            (reached ? 'border-color:'+col+';background:'+col+'26;box-shadow:0 0 12px '+col+'40;'
                     : 'border-color:'+col+'4d;opacity:.5;')+
            'border-left:5px solid '+col+';';      // last, so it wins the left edge either way
          return '<div class="lrow" style="'+style+'">'+
            '<span class="lrank" style="color:'+col+'">'+(reached?"\u2605":"\u2022")+'</span>'+
            '<span class="lname" style="color:'+col+'">'+t.name+'</span>'+
            '<b style="color:'+col+'">'+fmt(t.score)+'</b></div>';
        }).join("");
      })()+
      // bottom: progress toward the next milestone, painted in the band the player is
      // CURRENTLY in \u2014 so the bar changes colour the moment a rank-up moves them a band up.
      (next
        ? '<div class="mrow" style="margin-top:12px;border-color:'+curColor+'">'+
            '<div class="mtop"><span>NEXT \u00b7 '+next.name+'</span><b style="color:'+curColor+'">'+fmt(next.score)+'</b></div>'+
            // Fill runs from the band you are in into the band the NEXT rank belongs to, so
            // the leading edge shows the colour you are climbing toward. Inside a band both
            // ends are the same colour and it reads as a flat bar, which is the honest signal.
            '<div class="mbar"><i style="width:'+progPct.toFixed(0)+'%;'+
              'background:linear-gradient(90deg,'+curColor+','+rankColor(next)+');'+
              'box-shadow:0 0 10px '+rankColor(next)+'80"></i></div>'+
            '<div class="msub">'+fmt(best)+' / '+fmt(next.score)+' \u00b7 '+fmt(next.score-best)+' to go</div></div>'
        : '<div class="mrow done" style="margin-top:12px;border-color:'+TEAL+'"><div class="mtop"><span>MAX RANK REACHED \u2605</span><b style="color:'+TEAL+'">XZILLA LEGEND</b></div></div>');
  }
  function renderSkins(){
    $("skinsInner").innerHTML =
      '<h2 class="pnl-title" style="border-color:'+TEAL+'">SKIN SHOP · '+fmt(econ.tokens)+' XP</h2>'+
      '<div class="sgrid">'+ SKINS.map(s=>{
        const owned=econ.skins.includes(s.id), eq=econ.skin===s.id;
        const rankLocked = !!s.rankReq && !owned;                 // earned by rank, not yet reached
        const can = !rankLocked && econ.tokens>=s.cost;
        const tint=s.tint||"#39ff7a";
        const label = eq?"EQUIPPED" : owned?"EQUIP" : rankLocked?("🔒 "+s.rankName) : s.cost===0?"FREE":fmt(s.cost);
        const bcol  = eq?TEAL : owned?MAG : rankLocked?GOLD : can?TEAL:"#444";
        return '<div class="scard'+(eq?' eq':'')+(rankLocked?' locked':'')+'" style="border-color:'+(eq?TEAL:rankLocked?"rgba(255,210,63,.4)":"#2a2150")+'">'+
          '<div class="sprev" style="filter:drop-shadow(0 0 12px '+tint+')'+(rankLocked?';opacity:.5':'')+'">🦖</div>'+
          '<div class="sname">'+s.name+'</div>'+
          '<button class="sbuy" data-skin="'+s.id+'" '+(!owned&&!can&&!rankLocked?"disabled":"")+
            ' style="border-color:'+bcol+';background:'+(eq?TEAL:"transparent")+';color:'+(eq?"#04130a":rankLocked?GOLD:"#fff")+';font-size:'+(rankLocked?"7px":"8px")+'">'+
            label+'</button></div>';
      }).join("")+'</div>';
    $("skinsInner").querySelectorAll(".sbuy").forEach(b=>b.onclick=()=>{
      const s=SKINS.find(s=>s.id===b.dataset.skin);
      if(econ.skins.includes(s.id)){ econ.skin=s.id; }
      else if(s.rankReq){ toast("Reach "+s.rankName+" to unlock this skin",RED); return; }
      else if(econ.tokens>=s.cost){ econ.tokens-=s.cost; econ.skins.push(s.id); econ.skin=s.id; toast("Unlocked "+s.name,TEAL); }
      else { toast("Not enough XP",RED); return; }
      saveEcon(); applySkin(); updateHUDtokens(); renderSkins();
    });
  }

  /* ------------------------------ daily streak ---------------------------- */
  function checkStreak(){
    const today=new Date().toDateString();
    const yest=new Date(Date.now()-864e5).toDateString();
    if(econ.streakDay===today) return;
    econ.streak = (econ.streakDay===yest) ? econ.streak+1 : 1;
    econ.streakDay=today;
    const bonus = 100*econ.streak;
    econ.tokens += bonus; saveEcon(); updateHUDtokens();
    toast("Daily streak "+econ.streak+"🔥 +"+bonus+" XP", GOLD);
  }

  /* ------------------------------- game flow ------------------------------ */
  const _gameOver = gameOver; // capture original (gameOver is called by name -> override applies)
  window.gameOver = function(){
    // Capture the canonical all-time best BEFORE _gameOver() bumps state.best and
    // before pushScore() bumps myBest. state.best (xzilla_best, the HUD/CloudStorage
    // number) is the real record; myBest (xz_mybest) can lag behind it across devices,
    // so a new-best check against myBest alone falsely fired on non-record runs.
    const _prevBest = Math.max(Math.round(state.best||0), (myBest && myBest.score) || 0);
    _gameOver();
    // economy + missions + leaderboard
    run.score=Math.max(run.score, state.score);
    // SCORE BONUS — XP used to come only from kill/boss COUNT, so a high-score run driven by
    // combos & multipliers could earn LESS XP than a grindy low-score run. Reward the actual
    // run score too (×0.10) so a better run always pays more XP.
    const scoreXP = Math.round(run.score * 0.10);
    // Count the score bonus toward run.earned so the big "EARNED +X XP" line on the game-over
    // screen reflects the WHOLE payout. Before, that headline showed only kill/boss XP, so a
    // high-score/combo run (few raw kills) read as ~10k even though the score bonus quietly
    // added 100k+ — it just flashed by as a separate toast and looked like nothing.
    if(scoreXP > 0){ econ.tokens += scoreXP; run.earned += scoreXP; toast("Score bonus +"+fmt(scoreXP)+" XP", GOLD); }
    // (kill/boss earnings were already added live during play; persist everything now)
    saveEcon();
    missions.forEach(m=>{
      if(m.done) return;
      if(m.stat==="combo"||m.stat==="score") m.prog=Math.max(m.prog, run[m.stat]);
      else m.prog += run[m.stat];
      if(m.prog>=m.goal){ m.done=true; econ.tokens+=m.reward; toast("Bounty complete +"+fmt(m.reward)+" XP",TEAL); }
    });
    saveMissions(); saveEcon();
    pushScore(state.score);
    progressDaily();      // tally the daily challenge from this run
    progressWeekly();     // tally the weekly challenge from this run
    syncRankSkins();      // unlock any rank-reward skins the new best just earned
    submitLeaderboard();  // post THIS run's score to the cross-player board (if configured)
    // augment game over screen
    const go=$("gameOverScreen");
    // EARNED-XP line lives inside .go-stats so it joins the stats row in landscape.
    const goStats=go.querySelector(".go-stats");
    let extra=$("goExtra");
    if(!extra){ extra=document.createElement("div"); extra.id="goExtra"; extra.className="stat";
      if(goStats) goStats.appendChild(extra); else go.querySelector(".go-buttons").before(extra); }
    extra.innerHTML = 'EARNED <span class="num" style="color:'+GOLD+'">+'+fmt(run.earned)+'</span> XP';
    // active ranking: the milestone earned by the player's BEST score, plus how far
    // that best is from the next milestone (myBest is freshest — pushScore ran above).
    const rankEl=$("goRank");
    if(rankEl){
      const bestSc=Math.max(Math.round(state.best||0), Math.round(state.score), (myBest&&myBest.score)||0);
      const cur=titleForScore(bestSc);
      let next=null; for(const tier of SCORE_TITLES){ if(tier.score>bestSc && (!next||tier.score<next.score)) next=tier; }
      rankEl.innerHTML='<span class="go-rank-label">ACTIVE RANK</span>'+
        '<span class="go-rank-cur">★ '+(cur?cur.name:"UNRANKED")+'</span>'+
        (next ? '<span class="go-rank-next">'+fmt(next.score-bestSc)+' pts to '+next.name+'</span>'
              : '<span class="go-rank-next">MAX RANK REACHED</span>')+
        // global-rank line: filled async by submitLeaderboard() when /submit replies
        ((lbApi() && tg && tg.initData) ? '<span class="go-rank-world" id="goWorldRank">🌍 finding your global rank…</span>' : '');
    }
    // NEW PERSONAL BEST → celebratory one-tap share CTA (frictionless virality)
    const isNewBest = Math.round(state.score) > _prevBest && Math.round(state.score) > 0;
    let nb=$("goNewBest");
    if(!nb){ nb=document.createElement("div"); nb.id="goNewBest"; nb.style.cssText="margin:8px 0;text-align:center;display:none";
      go.querySelector(".go-buttons").before(nb); }
    if(isNewBest){
      nb.style.display="block";
      nb.innerHTML='<div style="color:'+GOLD+';font-weight:700;letter-spacing:1px;margin-bottom:6px">🎉 NEW PERSONAL BEST!</div>'+
        '<button class="btn" id="goShareBest">📣 SHARE YOUR RECORD</button>';
      const b=$("goShareBest"); if(b) b.onclick=shareScore;
      try{ if(tg&&tg.HapticFeedback) tg.HapticFeedback.notificationOccurred("success"); }catch(_){}
    } else if(nb){ nb.style.display="none"; }
    updateHUDtokens();
    $("tabbar").classList.remove("hidden");
  };

  // pre-run hooks via extra listeners (start/retry buttons hold direct refs)
  function beforeRun(){
    resetRun();
    for(let i=active.length-1;i>=0;i--){ if(active[i].type===TYPE.BOSS) freeEntity(active[i]); }
    hideAllOverlays(); $("gameOverScreen").classList.add("hidden"); $("tabbar").classList.add("hidden");
    updateVip(); applySkin();
  }
  ["startBtn","retryBtn"].forEach(id=>{ const b=$(id); if(b) b.addEventListener("click", beforeRun); });
  // (Removed the start-screen "demo bag" grant — the connect button now performs a REAL
  //  on-chain $XZILLA holder check in index.html. Simulated tiers remain in the WALLET tab.)

  // tab bar wiring
  document.querySelectorAll("#tabbar .tab").forEach(b=> b.addEventListener("click", ()=>showTab(b.dataset.tab)) );

  // game over: PLAY AGAIN already wired; add MENU + SHARE buttons
  (function(){
    const gb=document.querySelector("#gameOverScreen .go-buttons"); if(!gb) return;
    const menu=document.createElement("button"); menu.className="btn secondary"; menu.textContent="◀ MENU";
    menu.addEventListener("click", ()=>{ $("gameOverScreen").classList.add("hidden");
      $("tabbar").classList.remove("hidden"); showTab("PLAY"); });
    const share=document.createElement("button"); share.className="btn secondary"; share.textContent="📣 SHARE SCORE";
    share.addEventListener("click", shareScore);
    gb.appendChild(menu); gb.appendChild(share);
  })();

  /* ========================================================================== *
   *  SET 2 — DEPTH UPDATE                                                       *
   *  Adds: new enemy archetypes, wave structure, power-ups, an upgrade tree     *
   *  spent in XP, tier effects that actually bite, real skin art, and a         *
   *  structured leaderboard. Defined last so its spawn/resolve/__frame/addScore *
   *  overrides win. Everything reuses in-scope helpers from the layers above.   *
   * ========================================================================== */
  (function(){
    if (typeof THREE === "undefined") return;

    /* ----- new entity type ids (extend, don't clobber) ---------------------- */
    TYPE.HONEYPOT = 5;   // looks catchable, costs a life if you grab it
    TYPE.DECOY    = 6;   // fake airdrop — grabbing it kills your combo
    TYPE.RUGBOSS  = 7;   // multi-hit boss with a health bar
    TYPE.PWR_SLOW = 8;   // slow-mo
    TYPE.PWR_X2   = 9;   // double score window
    TYPE.PWR_MAG  = 10;  // scammer magnet
    TYPE.HEART    = 11;  // heart-shaped extra-life token (TEST)
    TYPE.PWR_TRI  = 12;  // TRI-CANNON: rare gun pickup, boss-fight only (see updateCannon)
    TYPE.PWR_ROCKET = 13; // ROCKET LAUNCHER: rare boss-fight pickup, cannon fires homing rockets

    /* ----- upgrade tree (persisted, spent in XP) ----------------------------- */
    const UPGRADES = [
      {id:"hp",    name:"REINFORCED SCALES", desc:"+1 max HP per level",       max:4, base:4000,  step:2.4},
      {id:"combo", name:"DIAMOND GRIP",      desc:"Wider combo window",        max:4, base:2500,  step:2.0},
      {id:"drop",  name:"DEGEN LUCK",        desc:"+15% XP per kill / lvl",max:5, base:3000,  step:2.1},
      {id:"pwr",   name:"POWER MAGNET",      desc:"Power-ups spawn more often", max:4, base:5000,  step:2.6},
      {id:"start", name:"HEAD START",        desc:"Begin each run with a shield",max:1, base:8000,  step:1},
      {id:"warm",  name:"WARM ENGINE",       desc:"Begin runs at combo ×2, +1 per level",max:3, base:3500, step:2.1},
      {id:"nearmiss",name:"CLOSE CALL",      desc:"+50% near-miss dodge bonus / lvl",max:3, base:4500, step:2.2},
      {id:"rugradar",name:"RUG RADAR",       desc:"More RUGGERs spawn — the 2× value scammer / lvl",max:3, base:5000, step:2.3},
      // ---- ELITE TIER: expensive, end-game power spikes ----
      {id:"midas",   name:"MIDAS RUSH",     desc:"+12% to all score / lvl",        max:4, base:12000, step:2.3, elite:true},
      {id:"buffdur", name:"OVERDRIVE CORE", desc:"Power-ups last +35% longer / lvl",max:4, base:9000,  step:2.2, elite:true},
      {id:"nitro",   name:"NITRO LAUNCH",   desc:"Open each run with SCORE ×2 (8s, +4s/lvl)",max:3, base:16000, step:1.7, elite:true},
      {id:"bosshunt",name:"BOSS HUNTER",    desc:"+25% XP & score from Rug Bosses / lvl",max:3, base:14000, step:2.2, elite:true},
      {id:"revive",  name:"SECOND WIND",    desc:"Cheat death once per run",        max:1, base:30000, step:1, elite:true},
      // ---- ENDLESS SINK: small permanent score boost with no practical ceiling, so
      //      players who've maxed everything else always have somewhere to burn XP. ----
      {id:"overclock",name:"OVERCLOCK",     desc:"+2.5% score / lvl — no ceiling in sight",max:8, base:18000, step:1.45, elite:true}
    ];
    let upg = store.get("xz_upg", null);
    if(!upg || typeof upg!=="object"){ upg={}; }
    UPGRADES.forEach(u=>{ if(typeof upg[u.id]!=="number") upg[u.id]=0; });
    function saveUpg(){ store.set("xz_upg", upg); }
    function upgCost(u){ return Math.round(u.base * Math.pow(u.step, upg[u.id])); }
    function lvl(id){ return upg[id]||0; }

    /* apply persistent upgrades to CFG/run baselines ------------------------- */
    function applyUpgrades(){
      CFG.lives = 3 + lvl("hp");                 // base + reinforced scales
      // combo window: base loop uses fixed catch band; we widen catchX virtually
      window.__catchBonus = lvl("combo") * 0.22; // consumed in our resolve test
      window.__dropMult   = 1 + lvl("drop")*0.15;
      window.__pwrBonus   = lvl("pwr")*0.035;    // added to powerup chance
      window.__nearMissMult = 1 + lvl("nearmiss")*0.5;  // CLOSE CALL — bigger reward for dodging by a hair
      window.__rugChance  = lvl("rugradar")*0.15;    // RUG RADAR — chance a spawned scammer is the high-value RUGGER
      window.__scoreMult  = (1 + lvl("midas")*0.12) * (1 + lvl("overclock")*0.025); // MIDAS RUSH + endless OVERCLOCK
      window.__buffMult   = 1 + lvl("buffdur")*0.35; // OVERDRIVE CORE — longer power-ups
      window.__bossBonus  = 1 + lvl("bosshunt")*0.25; // BOSS HUNTER — extra XP & score from Rug Bosses
    }
    applyUpgrades();

    /* RUGGER = the high-value scammer. Identified by its material (myScammerMats[1], same
     * check the animator uses), it's worth RUG_POINT_MULT× a normal scammer. RUG RADAR
     * (below) then biases the spawn mix toward it. */
    const RUG_POINT_MULT = 2;
    function isRugger(e){ return !!(e && e.sprite && typeof myScammerMats!=="undefined" && myScammerMats && e.sprite.material===myScammerMats[1]); }
    // RUGGERs are worth 2× ONLY once RUG RADAR is owned — no baseline score change without the upgrade.
    function scammerPts(e){ return (lvl("rugradar")>0 && isRugger(e)) ? CFG.scammerPoints*RUG_POINT_MULT : CFG.scammerPoints; }

    /* ----- tier effects: holdings now grant a real gameplay edge ------------ */
    function tierScoreMult(){ return tierFor(econ.holdings).m; }      // already wired to score
    function tierDropMult(){ const m=tierFor(econ.holdings).m; return 1 + (m-1)*0.5; } // softer econ bonus

    /* ===================================================================== *
     *  NEW ART — drawn in the same neon language as the existing sprites      *
     * ===================================================================== */
    function glowBack2(x,S,c,r){ const g=x.createRadialGradient(S/2,S/2,8,S/2,S/2,r);
      g.addColorStop(0,c+"aa"); g.addColorStop(.55,c+"33"); g.addColorStop(1,c+"00"); x.fillStyle=g; x.fillRect(0,0,S,S); }

    // HONEYPOT — a glossy amber jar that LOOKS like a pickup but stings
    function drawHoney(x,S){
      const cx=S/2, cy=S/2; glowBack2(x,S,"#ffae00",S*0.5);
      x.save(); x.shadowColor="#ffae00"; x.shadowBlur=26;
      const g=x.createLinearGradient(0,cy-70,0,cy+86);
      g.addColorStop(0,"#ffe08a"); g.addColorStop(1,"#c97a00");
      x.fillStyle=g; roundRect(x,cx-72,cy-54,144,150,30); x.fill(); x.restore();
      x.fillStyle="#3a2400"; x.font="bold 30px Orbitron, sans-serif"; x.textAlign="center"; x.textBaseline="middle";
      x.fillText("HONEY", cx, cy+8);
      // a sly drip + warning glint
      x.fillStyle="#fff"; x.globalAlpha=.5; x.beginPath(); x.ellipse(cx-30,cy-30,16,26,-0.5,0,7); x.fill(); x.globalAlpha=1;
      x.fillStyle="#ff3b5c"; x.font="40px serif"; x.fillText("⚠", cx+86, cy-70);
    }
    // DECOY — fake "AIRDROP" gift box
    function drawDecoy(x,S){
      const cx=S/2, cy=S/2; glowBack2(x,S,"#21e6ff",S*0.5);
      x.save(); x.shadowColor="#21e6ff"; x.shadowBlur=24; x.fillStyle="#0e3a4a";
      roundRect(x,cx-74,cy-50,148,128,18); x.fill(); x.restore();
      x.fillStyle="#21e6ff"; x.fillRect(cx-74,cy-8,148,16);
      x.fillRect(cx-8,cy-50,16,128);
      x.fillStyle="#bff6ff"; x.font="bold 22px Orbitron, sans-serif"; x.textAlign="center"; x.textBaseline="middle";
      x.fillText("AIRDROP", cx, cy-72);
      x.font="34px serif"; x.fillText("🎁", cx, cy+96);
    }
    // power-up pickups — clean glyph chips
    function chip(x,S,color,glyph){
      const cx=S/2, cy=S/2; glowBack2(x,S,color,S*0.46);
      x.save(); x.shadowColor=color; x.shadowBlur=26;
      x.fillStyle="#0a0618"; x.beginPath(); x.arc(cx,cy,70,0,7); x.fill();
      x.lineWidth=7; x.strokeStyle=color; x.beginPath(); x.arc(cx,cy,70,0,7); x.stroke(); x.restore();
      x.fillStyle=color; x.font="58px serif"; x.textAlign="center"; x.textBaseline="middle";
      x.fillText(glyph, cx, cy+4);
    }
    const matHoney = spriteMat(drawHoney);
    const matDecoy = spriteMat(drawDecoy);
    const matSlow  = spriteMat((x,S)=>chip(x,S,"#7df9ff","⏳"));
    const matX2    = spriteMat((x,S)=>chip(x,S,GOLD,"✕2"));
    const matMag   = spriteMat((x,S)=>chip(x,S,MAG,"🧲"));
    // TRI-CANNON pickup — a gun on a glowing chip, three muzzle flashes fanning out to
    // telegraph the 3-way spread. Orange-gold so it reads as a rare, high-value power token.
    const TRI_COL  = "#ff8a1e";
    function drawTriGun(x,S){
      const cx=S/2, cy=S/2; glowBack2(x,S,TRI_COL,S*0.46);
      x.save(); x.shadowColor=TRI_COL; x.shadowBlur=26;
      x.fillStyle="#0a0618"; x.beginPath(); x.arc(cx,cy,70,0,7); x.fill();
      x.lineWidth=7; x.strokeStyle=TRI_COL; x.beginPath(); x.arc(cx,cy,70,0,7); x.stroke(); x.restore();
      // three fanned barrels from a muzzle point low-centre, pointing "up" (toward the lane)
      const mx=cx, my=cy+34, len=52;
      x.save(); x.lineCap="round"; x.strokeStyle=TRI_COL; x.shadowColor=TRI_COL; x.shadowBlur=14;
      for(const a of [-0.7, 0, 0.7]){
        const ex=mx+Math.sin(a)*len, ey=my-Math.cos(a)*len;
        x.lineWidth=10; x.beginPath(); x.moveTo(mx,my); x.lineTo(ex,ey); x.stroke();
        x.fillStyle="#fff"; x.beginPath(); x.arc(ex,ey,7,0,7); x.fill();   // bright muzzle tip
      }
      // stubby gun body + grip under the muzzle so it reads as a weapon, not just arrows
      x.fillStyle=TRI_COL; x.fillRect(mx-16,my-2,32,20);
      x.fillRect(mx-4,my+16,14,22);
      x.restore();
    }
    const matTri   = spriteMat(drawTriGun);
    // ROCKET LAUNCHER pickup — a rocket on a glowing chip. Flame-orange so it reads distinct
    // from the TRI-CANNON's gold and telegraphs "boss-melting ordnance".
    const ROCKET_COL = "#ff4d2e";
    function drawRocket(x,S){
      const cx=S/2, cy=S/2; glowBack2(x,S,ROCKET_COL,S*0.46);
      x.save(); x.shadowColor=ROCKET_COL; x.shadowBlur=26;
      x.fillStyle="#0a0618"; x.beginPath(); x.arc(cx,cy,70,0,7); x.fill();
      x.lineWidth=7; x.strokeStyle=ROCKET_COL; x.beginPath(); x.arc(cx,cy,70,0,7); x.stroke(); x.restore();
      x.save(); x.translate(cx,cy); x.shadowColor=ROCKET_COL; x.shadowBlur=14;
      // body (pointing up toward the lane)
      x.fillStyle="#e9e9f2"; x.beginPath();
      x.moveTo(0,-46); x.quadraticCurveTo(16,-20,16,10); x.lineTo(-16,10);
      x.quadraticCurveTo(-16,-20,0,-46); x.closePath(); x.fill();
      // nose cone
      x.fillStyle=ROCKET_COL; x.beginPath(); x.moveTo(0,-46);
      x.quadraticCurveTo(10,-30,7,-18); x.lineTo(-7,-18); x.quadraticCurveTo(-10,-30,0,-46); x.fill();
      // fins
      x.beginPath(); x.moveTo(-16,10); x.lineTo(-30,26); x.lineTo(-16,-4); x.fill();
      x.beginPath(); x.moveTo( 16,10); x.lineTo( 30,26); x.lineTo( 16,-4); x.fill();
      // porthole
      x.fillStyle="#0a0618"; x.beginPath(); x.arc(0,-14,7,0,7); x.fill();
      // exhaust flame
      x.fillStyle="#ffd23f"; x.beginPath(); x.moveTo(-10,10); x.lineTo(0,42); x.lineTo(10,10); x.closePath(); x.fill();
      x.restore();
    }
    const matRocket = spriteMat(drawRocket);
    // TEST: heart-shaped extra-life token (drawn, not a glyph chip)
    const matHeart = spriteMat((x,S)=>{
      const cx=S/2, cy=S*0.52, s=S*0.30;
      x.save(); x.shadowColor=RED; x.shadowBlur=S*0.13; x.fillStyle="#ff4d6d";
      x.beginPath();
      x.moveTo(cx, cy + s*0.85);
      x.bezierCurveTo(cx - s*1.5, cy - s*0.40, cx - s*0.6, cy - s*1.35, cx, cy - s*0.42);
      x.bezierCurveTo(cx + s*0.6, cy - s*1.35, cx + s*1.5, cy - s*0.40, cx, cy + s*0.85);
      x.closePath(); x.fill();
      x.lineWidth=S*0.018; x.strokeStyle="#ffd1dc"; x.stroke(); x.restore();
      x.fillStyle="rgba(255,255,255,.5)";
      x.beginPath(); x.ellipse(cx - s*0.5, cy - s*0.32, s*0.26, s*0.40, -0.5, 0, 7); x.fill();
    });
    // RUG BOSS — angrier whale variant in rug-red
    const matRug   = spriteMat((x,S)=>{ drawWhale(x,S);
      x.fillStyle="rgba(255,59,92,.28)"; x.fillRect(0,0,S,S);
      x.fillStyle=RED; x.font="bold 34px 'Press Start 2P',monospace"; x.textAlign="center"; x.textBaseline="middle";
      x.fillText("RUG", S/2, S*0.16); });

    // Rug Boss art is a 2×1 sheet (bossDriving_sheet.webp, 1094×752 = two 547×752 frames)
    // whose only difference is the monster-truck tread rotation. Cycled via repeat+offset in
    // the chase loop (#tire-anim) exactly like the player's __BIKER sheet.
    window.__BOSSSHEET={cols:2, rows:1, frames:2};

    /* ===== embedded enemy sprites (re-embedded from uploaded grid) ===== */
    (function applyEnemySprites(){
      const SPR = window.XZILLA_SPRITES; if(!SPR) return;
      const swap=(mat,key,after)=>{ if(!mat||!SPR[key]) return;
        const l=new THREE.TextureLoader();
        l.load(SPR[key], t=>{ t.encoding=THREE.sRGBEncoding;
          try{ t.anisotropy=4; }catch(_){}
          if(after) after(t);
          mat.map=t; mat.needsUpdate=true; }); };
      if (typeof myScammerMats!=="undefined" && myScammerMats){
        swap(myScammerMats[0],"kol");
        swap(myScammerMats[1],"rugger");
        swap(myScammerMats[2],"snake");
        swap(myScammerMats[3],"fudster");
      }
      if (typeof myHolderMat!=="undefined") swap(myHolderMat,"hodler");
      swap(matHoney,"honeypot");
      swap(matDecoy,"fakedrop");
      swap(matRug,"rugboss", t=>{
        const B=window.__BOSSSHEET;
        t.repeat.set(1/B.cols, 1/B.rows); t.offset.set(0, 1-1/B.rows);
      });
    })();

    /* ----- skin art: render the real Xzilla tint chips on skin cards -------- */
    // The base skin shop draws a 🦖 with a tint; we upgrade each card preview to
    // a small canvas portrait so skins read as distinct cosmetics, not an emoji.
    function skinPortrait(tint){
      const S=120, c=document.createElement("canvas"); c.width=c.height=S;
      const x=c.getContext("2d"); const col=tint||"#39ff7a";
      glowBack2(x,S,col,S*0.5);
      x.save(); x.shadowColor=col; x.shadowBlur=18; x.fillStyle="#0b1f12";
      x.beginPath(); x.arc(S/2,S/2,38,0,7); x.fill(); x.restore();
      // spikes
      x.fillStyle=col; for(let i=0;i<9;i++){ const a=Math.PI+ i/8*Math.PI;
        x.beginPath(); x.moveTo(S/2+Math.cos(a)*36,S/2+Math.sin(a)*36);
        x.lineTo(S/2+Math.cos(a)*52,S/2+Math.sin(a)*52);
        x.lineTo(S/2+Math.cos(a+0.16)*36,S/2+Math.sin(a+0.16)*36); x.closePath(); x.fill(); }
      // eyes
      x.fillStyle="#eaffea"; x.beginPath(); x.ellipse(S/2-14,S/2-2,7,10,0,0,7);
      x.ellipse(S/2+14,S/2-2,7,10,0,0,7); x.fill();
      x.fillStyle=col; x.beginPath(); x.arc(S/2-14,S/2-1,3.4,0,7); x.arc(S/2+14,S/2-1,3.4,0,7); x.fill();
      // grin
      x.strokeStyle="#eaffea"; x.lineWidth=3; x.beginPath();
      let mx=S/2-16,my=S/2+18; x.moveTo(mx,my);
      for(let i=0;i<6;i++){ mx+=5.5; my+=(i%2?5:-5); x.lineTo(mx,my); } x.stroke();
      return c.toDataURL();
    }
    // monkey-patch renderSkins to swap the emoji preview for a portrait
    const _renderSkins = renderSkins;
    renderSkins = function(){
      _renderSkins();
      try{
        $("skinsInner").querySelectorAll(".scard").forEach((card,i)=>{
          const s=SKINS[i]; if(!s) return; const prev=card.querySelector(".sprev");
          if(prev){ prev.textContent=""; const img=document.createElement("img");
            img.src=skinPortrait(s.tint); img.style.width="54px"; img.style.height="54px";
            img.style.imageRendering="auto"; prev.appendChild(img); }
        });
      }catch(e){}
    };

    /* ===================================================================== *
     *  RUNTIME STATE for power-ups / waves                                    *
     * ===================================================================== */
    const px = { slowUntil:0, x2Until:0, magUntil:0, rugHp:0, rugMax:0, triUntil:0, rocketUntil:0 };
    let reviveAvail = false;   // SECOND WIND charge, armed at run start if owned
    function nowS(){ return performance.now()*0.001; }
    function powActive(t){ return nowS() < t; }

    /* wave config: difficulty ramps in bands instead of one flat slope ------- */
    function waveProfile(){
      const w = state.wave;
      return {
        holderChance: Math.min(0.42, 0.30 + w*0.006),
        honeyChance:  Math.min(0.10, 0.02 + w*0.004),
        decoyChance:  Math.min(0.08, 0.015 + w*0.003),
        powerChance:  Math.min(0.10, CFG.powerupChance + (window.__pwrBonus||0) + w*0.002),
        speedBonus:   w*0.10
      };
    }

    /* ===================================================================== *
     *  SPAWN OVERRIDE — wider enemy roster + waves + power variety            *
     * ===================================================================== */
    let rugPending=false, nextBossWave=4, rugWarnUntil=0;   // first boss at wave 4, then 4 waves after each defeat
    // Waves advance off SCORE, which the upgrade update inflated hard — so bosses were
    // cascading every few seconds late-game. Floor the spacing with a real TIME cooldown:
    // no new boss until MIN_BOSS_GAP seconds after the last one was defeated.
    let lastBossEnd = 0;
    const MIN_BOSS_GAP = 45;   // seconds of normal play guaranteed between boss fights
    window.spawn = function(){
      // every 4th wave -> rug boss (replaces plain whale cadence). A 3s warning runs
      // first (rugWarnUntil) during which every ad-screen flashes "RUG INCOMING".
      if(rugPending && !active.some(a=>a.type===TYPE.RUGBOSS || a.type===TYPE.BOSS)){
        if(nowS() >= rugWarnUntil){ rugPending=false; window.__rugWarn=false; window.__rugBossAt=0; spawnRug(); return; }
        // still inside the warning window — fall through and spawn a normal enemy this tick
      }
      // RND() (not Math.random) so a DAILY RUG RUN deals every player the same hand.
      const e=getEntity(), wp=waveProfile(), r=RND();
      let cum=0;
      const place=(scale)=>{ e.hp=1; e.bhits=0;   // bhits: tracer rounds taken (3 => effect)
        e.sprite.position.set((RND()*2-1)*playHalfWidth,0.9,SPAWN_Z);
        e.prevZ=SPAWN_Z; e.sprite.scale.set(scale,scale,1); active.push(e); };

      // TRI-CANNON pickup — boss-fight ONLY, at most once per fight. Checked before the normal
      // weighted table so its rare roll isn't diluted by the other buckets. (place() resets
      // e.bhits so the shootable-entity bookkeeping stays consistent even though you catch it.)
      if(!_triThisFight && bossOnField() && RND()<TRI_SPAWN_CHANCE){
        _triThisFight=true; e.type=TYPE.PWR_TRI; e.sprite.material=matTri; place(2.4); return;
      }
      // ROCKET LAUNCHER pickup — once per fight during a boss (like the tri-cannon), OR rarely
      // during normal play (time-gated) since rockets now home on scammers too.
      if(bossOnField()){
        if(!_rocketThisFight && RND()<ROCKET_SPAWN_CHANCE){
          _rocketThisFight=true; e.type=TYPE.PWR_ROCKET; e.sprite.material=matRocket; place(2.4); return;
        }
      } else if(nowS()>=_rocketNormAt && RND()<ROCKET_SPAWN_CHANCE_NORM){
        _rocketNormAt=nowS()+ROCKET_NORM_GAP; e.type=TYPE.PWR_ROCKET; e.sprite.material=matRocket; place(2.4); return;
      }
      // TEST: heart-shaped extra-life token — 2% of spawns
      cum += 0.02;
      if(r<cum){ e.type=TYPE.HEART; e.sprite.material=matHeart; place(2.3); return; }
      // power-up bucket
      cum += wp.powerChance;
      if(r<cum){
        const roll=RND();
        if(roll<0.45){ e.type=TYPE.SHIELD; e.sprite.material=myShieldMat; }
        else if(roll<0.62){ e.type=TYPE.BOMB; e.sprite.material=myBombMat; }
        else if(roll<0.75){ e.type=TYPE.PWR_SLOW; e.sprite.material=matSlow; }
        else if(roll<0.88){ e.type=TYPE.PWR_X2; e.sprite.material=matX2; }
        else { e.type=TYPE.PWR_MAG; e.sprite.material=matMag; }
        place(2.3); return;
      }
      // honeypot trap
      cum += wp.honeyChance;
      if(r<cum){ e.type=TYPE.HONEYPOT; e.sprite.material=matHoney; place(2.5); return; }
      // decoy airdrop
      cum += wp.decoyChance;
      if(r<cum){ e.type=TYPE.DECOY; e.sprite.material=matDecoy; place(2.5); return; }
      // holder (do-not-hit) — SUPPRESSED during a boss fight so the boss and its thrown
      // projectiles are the only hazard on the field; the holder probability mass falls
      // through to a scammer instead of spawning a friendly you must dodge.
      cum += wp.holderChance;
      if(r<cum && !bossOnField()){ e.type=TYPE.HOLDER; e.sprite.material=myHolderMat; place(2.7); return; }
      // default scammer — RUG RADAR biases the mix toward the high-value RUGGER (index 1)
      e.type=TYPE.SCAMMER;
      let _mi=(RND()*myScammerMats.length)|0;
      if(RND() < (window.__rugChance||0)) _mi=1;
      e.sprite.material=myScammerMats[_mi];
      place(2.8);
      e._rugger=(_mi===1); e._threw=false;   // ruggers can lob "empty promises" (see updateThrows)
    };

    // BOSS AURA — a pulsing red halo drawn BEHIND the truck so its dark silhouette reads
    // against the neon skyline (fixes the "faint/transparent" look). Additive glow, built once.
    let _bossGlow=null;
    function bossGlowSprite(){
      if(_bossGlow) return _bossGlow;
      const S=256, c=document.createElement("canvas"); c.width=c.height=S;
      const x=c.getContext("2d");
      // RIM, not a filled disc. This sprite is ADDITIVE and sits behind the truck, so a
      // bright core (it was 0.95 alpha at the centre) added light straight through the
      // body and washed it into fog — the head read fine only because it sits above the
      // hottest part of the gradient. Keeping the core clear preserves what the halo is
      // for (separating a dark silhouette from the neon skyline) without veiling the art.
      const g=x.createRadialGradient(S/2,S/2,8, S/2,S/2,S/2);
      g.addColorStop(0.00,"rgba(255,70,110,0)");
      g.addColorStop(0.44,"rgba(255,70,110,0.08)");
      g.addColorStop(0.66,"rgba(255,50,120,0.50)");
      g.addColorStop(1.00,"rgba(255,40,120,0)");
      x.fillStyle=g; x.fillRect(0,0,S,S);
      const m=new THREE.SpriteMaterial({ map:new THREE.CanvasTexture(c), transparent:true,
        blending:THREE.AdditiveBlending, depthWrite:false });
      _bossGlow=new THREE.Sprite(m); _bossGlow.renderOrder=-1; _bossGlow.visible=false; scene.add(_bossGlow);
      return _bossGlow;
    }
    function spawnRug(){
      const e=getEntity();
      // TEST: HP is scaled up so the auto-cannon visibly grinds the boss down
      // (each tracer chips 1 HP at ~20 rounds/sec) instead of popping it instantly.
      px.rugMax = (3 + Math.floor(state.wave/4)) * 8;   // grows over the run
      px.rugHp  = px.rugMax;
      _triThisFight=false; _rocketThisFight=false;   // new fight — re-arm the one-per-fight gun drops
      bossFightStart=nowS();   // clock the fight so the red-candle barrage can escalate over time
      e.type=TYPE.RUGBOSS; e.hp=px.rugHp; e.sprite.material=matRug;
      e.sprite.scale.set(BOSS_W,BOSS_H,1);
      e._bw=BOSS_W; e._bh=BOSS_H; e._by=BOSS_BASE_Y;   // base dims for the aspect-preserving "alive" anim
      e.sprite.position.set(0,BOSS_BASE_Y,SPAWN_Z-6); e.prevZ=e.sprite.position.z; active.push(e);
      bigBanner("⚠ RUG BOSS ⚠"); flashColor("rgba(255,59,92,.45)",0.7); shake(1.0);
      showRugBar();
      try{ if(tg&&tg.HapticFeedback) tg.HapticFeedback.notificationOccurred("warning"); }catch(_){}
    }

    /* boss health bar (DOM, reuses HUD style vocabulary) --------------------- */
    function showRugBar(){
      let bar=$("rugBar");
      if(!bar){
        bar=document.createElement("div"); bar.id="rugBar";
        bar.style.cssText="position:fixed;left:50%;top:96px;transform:translateX(-50%);z-index:24;"+
          "width:62vw;max-width:340px;height:14px;border:2px solid "+RED+";border-radius:9px;"+
          "background:rgba(7,3,24,.7);overflow:hidden;box-shadow:0 0 18px rgba(255,59,92,.5)";
        bar.innerHTML='<i style="display:block;height:100%;width:100%;background:'+RED+';transition:width .15s"></i>';
        document.body.appendChild(bar);
      }
      bar.style.display="block"; updateRugBar();
    }
    function updateRugBar(){ const bar=$("rugBar"); if(!bar) return;
      bar.querySelector("i").style.width = Math.max(0,(px.rugHp/px.rugMax)*100)+"%"; }
    function hideRugBar(){ const bar=$("rugBar"); if(bar) bar.style.display="none"; }

    /* ===================================================================== *
     *  RESOLVE OVERRIDE — handles every new type                              *
     * ===================================================================== */
    const _origAddScore = window.addScore;
    window.addScore = function(base, worldPos){
      const x2 = powActive(px.x2Until) ? 2 : 1;
      // BUG #1: _origAddScore advances state.wave itself, so reading state.wave
      // AFTER it always sees the new value and the boss never scheduled. Capture
      // the wave BEFORE delegating, then detect the crossing here.
      const prevWave = state.wave;
      _origAddScore(base * x2, worldPos);
      // Schedule a boss once we reach the next boss wave — but NEVER while one is already
      // pending or on the field. The auto-cannon farms scammers during the (long ×8-HP)
      // fight, which inflates the wave; without this gate it would stack a second boss
      // that spawns the instant the first dies. nextBossWave advances on defeat (below).
      if(state.wave > prevWave && state.wave >= nextBossWave
         && nowS() >= lastBossEnd + MIN_BOSS_GAP     // enforce a real time gap between fights
         && !rugPending && !active.some(a=>a.type===TYPE.RUGBOSS||a.type===TYPE.BOSS)){
        rugPending=true; rugWarnUntil=nowS()+3; window.__rugWarn=true;   // 3s "RUG INCOMING" ad-screen warning before the boss
        window.__rugBossAt=rugWarnUntil;   // absolute time the boss will land — the red danger grid fades in 2s before this
        try{ if(tg&&tg.HapticFeedback) tg.HapticFeedback.notificationOccurred("warning"); }catch(_){}
      }
      // rank-milestone callout — once per run, the first time you cross a new title threshold
      const t = titleForScore(state.score);
      if(t && t.name!==run.lastTitle){ run.lastTitle=t.name; rankUpCelebration(t.name); }
    };

    /* Loud, full-screen rank-up moment: banner + flash overlay + particles + climb sfx + buzz. */
    function rankUpCelebration(name){
      showBanner("\u2605 RANK UP \u2605");
      try{ (window.__sfx&&window.__sfx.rankup)?window.__sfx.rankup():sfx.wave(); }catch(_){}
      flashColor("rgba(255,210,63,.45)",0.72); shake(0.95);
      try{ burst(player.position.x, player.position.y+0.5, PLAYER_Z, GOLD, 30);
           burst(player.position.x, player.position.y+0.5, PLAYER_Z, MAG, 18); }catch(_){}
      try{ window.__buzz && window.__buzz([40,30,60,30,110],"success"); }catch(_){}
      const rf=$("rankFlash"), tx=$("rankFlashTxt");
      if(rf && tx){ tx.textContent="\u2605 "+name+" \u2605";
        rf.classList.remove("hidden","show"); void rf.offsetWidth; rf.classList.add("show");
        clearTimeout(rf._t); rf._t=setTimeout(()=>{ rf.classList.remove("show"); rf.classList.add("hidden"); }, 1500); }
    }

    /* NEAR-MISS bonus: a dangerous item (HODLER / HONEYPOT) swept past just outside the
     * catch radius. Rewards threading the needle with a little score + juice. Hooked from
     * the base collision loop in index.html via window.__nearMiss. */
    window.__nearMiss = function(e){
      if(!(e.type===TYPE.HOLDER || e.type===TYPE.HONEYPOT)) return;
      const p=e.sprite.position.clone();
      const bonus=Math.round(8 * tierScoreMult() * (powActive(px.x2Until)?2:1) * (window.__nearMissMult||1));
      state.score+=bonus; renderScore();
      popup(p,"NEAR MISS +"+bonus,CYAN); burst(p.x,p.y,p.z,CYAN,6); pop=Math.max(pop,1.12);
      try{ window.__sfx && window.__sfx.nearmiss && window.__sfx.nearmiss(); }catch(_){}
      try{ window.__buzz && window.__buzz(16,"light"); }catch(_){}
    };

    /* ===================================================================== *
     *  AUTO-CANNON (TEST)                                                     *
     *  While a RUG BOSS is on the field, a machine gun on the bike fires      *
     *  non-stop until the boss is dead. Tracer rounds shred scammers + traps  *
     *  and chip the boss's health, but PASS THROUGH hodlers and power-ups so  *
     *  you can still collect the good stuff. Ramming the boss costs a life    *
     *  (see resolve above) — the gun is the only way to take it down.         *
     * ===================================================================== */
    const CANNON = { pool:[], live:[], cd:0, rate:0.05, speed:48, mat:null, cap:48 };
    const ROCKETS = { pool:[], live:[], cd:0, mat:null, cap:12 };   // homing rocket-launcher shots
    // CHASE BOSS — the Rug Boss is a whale that FLEES down the lane with the bag while
    // Xrider guns the chopper after it. It flies in from off-screen, then LOCKS a fixed
    // distance ahead (CHASE_Z) and holds there — weaving + hurling candles — until it dies.
    // The world keeps scrolling at FULL speed, which carries the whole "we're both flying
    // forward, I'm chasing it" illusion (the boss's z barely moves; the lane rushing past
    // sells the motion). Because it never reaches the player line it can't be rammed and
    // never "passes" you to re-fight — you stay engaged from spawn to kill.
    const CHASE_Z   = -9;    // world-z the fleeing boss holds (player at PLAYER_Z=8; farther = bigger chase gap)
    const CHASE_IN  = 2.5;   // fly-in easing rate toward CHASE_Z on spawn
    // Bullets used to fly all the way to SPAWN_Z-8 (-38), but the boss now sits at CHASE_Z
    // (-9), so ~60% of each bullet's travel was dead flight past everything — a live sprite
    // (= a draw call, the boss-fight perf bottleneck on mobile) the whole way. Cull them a
    // short distance PAST the boss instead: far enough to still shred oncoming traffic in the
    // lane behind it, but not the full empty runway to the spawn line.
    const BULLET_CULL_Z = CHASE_Z - 13;   // -22: ~13 units of reach past the boss into traffic
    // TRI-CANNON — a rare gun pickup that only drops DURING a boss fight and upgrades the
    // auto-cannon to a 3-way spread for a few seconds. Deliberately hard to get: a low
    // per-spawn roll, gated on an active boss, capped at one per fight — and you still have
    // to dodge to its lane past the candle barrage to catch it.
    const TRI_SPAWN_CHANCE = 0.05;   // per eligible spawn tick while a boss lives (difficulty knob)
    const TRI_ANGLE        = 0.70;   // side-stream fan, radians (~40°, "a bit less than 45")
    const TRI_SECS         = 10;     // active duration; 15 for a wallet-verified $XZILLA holder
    const TRI_SECS_HOLDER  = 15;
    let   _triThisFight    = false;  // one tri-gun per fight; reset in spawnRug + run reset
    // ROCKET LAUNCHER — a rare boss-fight pickup that, for a few seconds, has the auto-cannon
    // ALSO launch homing rockets that curve into the fleeing boss and detonate for a big HP
    // chunk each, dropping its time-to-kill sharply. One per fight, gated like the tri-cannon.
    const ROCKET_SPAWN_CHANCE = 0.045; // per eligible spawn tick while a boss lives
    const ROCKET_SECS         = 8;     // active window; longer for a verified $XZILLA holder
    const ROCKET_SECS_HOLDER  = 12;
    const ROCKET_RATE  = 0.42;   // seconds between homing rockets while active
    const ROCKET_DMG   = 6;      // boss HP removed per rocket detonation (tracer = 1)
    const ROCKET_SPEED = 26;     // world units/sec (slower than tracers so the arc reads)
    const ROCKET_TURN  = 3.2;    // homing steer rate, rad/sec
    const ROCKET_HITR  = 2.4;    // detonation half-extent around the boss
    let   _rocketThisFight = false;  // one rocket launcher per fight; reset in spawnRug + run reset
    let   _lastBoomAt = -9;          // detonation-sfx throttle (see updateRockets)
    // Normal-run rocket drop: rockets now home on scammers too, so the launcher can appear
    // outside boss fights — but rarely, and time-gated so it stays a treat, not a crutch.
    const ROCKET_SPAWN_CHANCE_NORM = 0.02;  // per spawn tick during normal play
    const ROCKET_NORM_GAP          = 35;    // min seconds between normal-run rocket drops
    let   _rocketNormAt = 0;                 // earliest nowS() a normal-run rocket may drop again
    const BULLET_XCULL     = 14;     // free a bullet once it flies this far off the lane in x
    const BOSS_SLOW = 0.5;   // world runs at HALF whatever the ramp reached when the boss lands
    const SLOWMO    = 0.5;   // SLOW-MO power-up scaler (stacks multiplicatively with BOSS_SLOW)
    let   _speedMult= 1;     // eased toward the combined target; published as window.__speedMult
    let   _jetCd    = 0;     // thruster-trail emit cadence accumulator
    let   _bossTireAcc = 0;  // boss tread-frame accumulator (#tire-anim)
    // Rug Boss art = images/bossDriving_sheet.webp (kaiju on a monster truck; 2×1 sheet of
    // 547×752 frames that differ only in tread rotation — see __BOSSSHEET).
    // The sprite is PORTRAIT, so size/ground it explicitly instead of the old 6.8 square. Held
    // close (CHASE_Z) + large so the dark truck reads as an imposing boss, not a faint speck.
    const BOSS_H      = 7.0;            // truck sprite world height
    const BOSS_W      = BOSS_H*0.727;   // ≈5.09 — one frame's aspect (547/752), so no stretch
    const BOSS_BASE_Y = 2.8;            // center height so the monster-truck wheels sit ~on the floor
                                        // (= old bottom edge -0.7 + BOSS_H/2, so shrinking the
                                        //  sprite keeps the wheels planted instead of floating)

    /* Machine-gun audio — ONE-SHOT per bullet using sounds/shot.m4a. A small pool of
     * <audio> elements is cycled round-robin so rapid fire can overlap. Plain <audio>
     * (no fetch/decodeAudioData) so it works over http AND file://. Honors the mute
     * toggle via state.soundOn. */
    const GUN_VOL = 0.5;
    const SHOT_SRC = 'sounds/shot.m4a';
    const SHOT_POOL = []; let shotIdx = 0;
    function shotInit(){
      if(SHOT_POOL.length) return;
      for(let i=0;i<8;i++){ try{ const a=new Audio(SHOT_SRC); a.preload='auto'; a.volume=0; SHOT_POOL.push(a); }catch(_){} }
    }
    // WebAudio buffer playback for the gun — decoded once, played via cheap buffer-source
    // nodes. At ~20 shots/sec this is essentially free; rapid HTML5 <audio>.play() spam is
    // what janks iOS Safari hard (the boss-fight lag). Falls back to the <audio> pool
    // (e.g. over file://, or until the buffer finishes decoding).
    let shotBuffer=null, shotDecoding=false;
    function ensureShotBuffer(){
      if(shotBuffer||shotDecoding) return;
      if(typeof actx==="undefined" || !actx) return;
      shotDecoding=true;
      fetch(SHOT_SRC).then(r=>r.arrayBuffer()).then(b=>actx.decodeAudioData(b))
        .then(dec=>{ shotBuffer=dec; shotDecoding=false; })
        .catch(()=>{ shotDecoding=false; });
    }
    function playShot(){
      if(state.soundOn===false) return;
      if(typeof actx!=="undefined" && actx){
        if(shotBuffer){
          try{ const s=actx.createBufferSource(); s.buffer=shotBuffer;
            const g=actx.createGain(); g.gain.value=GUN_VOL; s.connect(g); g.connect(sfxGain||actx.destination);
            s.start(); return; }catch(_){}
        } else { ensureShotBuffer(); }   // decode now; use the cheap fallback this frame
      }
      if(!SHOT_POOL.length){ shotInit(); if(!SHOT_POOL.length) return; }
      const a=SHOT_POOL[(shotIdx++)%SHOT_POOL.length];
      try{ a.currentTime=0; a.volume=GUN_VOL; a.play().catch(()=>{}); }catch(_){}
    }
    function gunOff(){ for(const a of SHOT_POOL){ try{ a.pause(); a.currentTime=0; }catch(_){} } }
    shotInit();   // preload the <audio> fallback pool

    function cannonMat(){
      if(CANNON.mat) return CANNON.mat;
      const c=document.createElement("canvas"); c.width=c.height=32;
      const g=c.getContext("2d");
      const grd=g.createRadialGradient(16,16,0,16,16,16);
      grd.addColorStop(0,"#fffbe0"); grd.addColorStop(0.35,GOLD); grd.addColorStop(1,"rgba(255,210,63,0)");
      g.fillStyle=grd; g.beginPath(); g.arc(16,16,16,0,Math.PI*2); g.fill();
      const t=new THREE.CanvasTexture(c); t.encoding=THREE.sRGBEncoding;
      CANNON.mat=new THREE.SpriteMaterial({ map:t, transparent:true, depthWrite:false, blending:THREE.AdditiveBlending });
      return CANNON.mat;
    }
    function getBullet(){
      let b=CANNON.pool.pop();
      if(!b){ b=new THREE.Sprite(cannonMat()); b.scale.set(0.85,0.85,1); scene.add(b); }
      b.visible=true; CANNON.live.push(b); return b;
    }
    function freeBullet(b){ const i=CANNON.live.indexOf(b); if(i<0) return; b.visible=false; CANNON.live.splice(i,1); CANNON.pool.push(b); }
    function clearBullets(){ for(let i=CANNON.live.length-1;i>=0;i--) freeBullet(CANNON.live[i]); CANNON.cd=0; }
    function bossOnField(){ for(const a of active){ if(a && !a.dead && a.type===TYPE.RUGBOSS) return a; } return null; }

    // Spawn one tracer with an explicit velocity. No audio/spark here — those are per-VOLLEY
    // (see fireVolley) so the 3-way spread costs the same sound + muzzle fill-rate as a single
    // shot, which is what keeps sustained fire cheap on iOS.
    function spawnBullet(x0,vx,vz){
      const b=getBullet();
      b.position.set(x0, player.position.y+0.25, PLAYER_Z-0.6);
      b._vx=vx; b._vz=vz; return b;
    }
    function fireVolley(boss){
      if(CANNON.live.length > CANNON.cap) return;   // perf valve — never let the pool spiral
      const x0=player.position.x;
      // centre stream — gentle lock-on so it reliably connects with the weaving boss
      spawnBullet(x0,(boss.sprite.position.x-x0)*0.85,-CANNON.speed);
      // TRI-CANNON: add two fixed-angle side streams. They fan OUTWARD from the player, so by
      // the time they reach the boss's depth they're far off-centre and sail past it — the
      // boss's time-to-kill is unchanged (still the centre stream only). Their job is the
      // off-centre TRAFFIC (scammers/honeypots/fake drops) the single cannon used to ignore.
      if(nowS() < px.triUntil){
        const s=Math.sin(TRI_ANGLE)*CANNON.speed, c=Math.cos(TRI_ANGLE)*CANNON.speed;
        spawnBullet(x0,-s,-c); spawnBullet(x0, s,-c);
      }
      burst(x0,player.position.y+0.25,PLAYER_Z-0.6,GOLD,1);   // ONE muzzle spark per volley
      playShot();                                             // ONE shot sound per volley
    }

    // Gun the boss down. Each tracer chips 1 HP; this defeats it at 0 (mirrors the
    // old ram-kill rewards). Returns true when the boss is destroyed this hit.
    function damageBoss(e){
      const p=e.sprite.position.clone();
      const dropMult=(window.__dropMult||1)*tierDropMult();
      px.rugHp--; updateRugBar();
      burst(p.x,p.y,p.z,RED,4);   // per-hit spark trimmed (was 8) — ~20 hits/sec adds up with bloom
      if(px.rugHp>0) return false;
      // defeated
      burst(p.x,p.y,p.z,MAG,46); burst(p.x,p.y,p.z,RED,40); burst(p.x,p.y,p.z,GOLD,24);
      shake(1.8); flashColor("rgba(255,59,92,.5)",0.85);
      const bb=window.__bossBonus||1;   // BOSS HUNTER
      const gain=Math.round(900*tierScoreMult()*(window.__scoreMult||1)*(window.__pumpMult||1)*bb); state.score+=gain; renderScore();
      const tok=Math.round(800*dropMult*bb); econ.tokens+=tok; run.earned+=tok; run.boss++;
      run.score=Math.max(run.score,state.score);
      popup(p,"+"+gain,GOLD); bigBanner("RUG SHREDDED");
      try{sfx.power();}catch(_){}
      hideRugBar(); clearBullets(); clearThrows(); gunOff();
      // The boss's death shockwave clears every scammer still on the field — and each
      // one now COUNTS toward your combo/kills/score, exactly like shredding it. Before,
      // the boss silently deleted them, robbing you of the combo you'd otherwise build.
      let cleared=0;
      for(let i=active.length-1;i>=0;i--){ const a=active[i];
        if(a!==e && a.type===TYPE.SCAMMER && !a.dead){ a.dead=true;
          const ap=a.sprite.position.clone();
          state.combo++; state.kills++; run.kills++; if(state.combo>run.combo) run.combo=state.combo;
          window.addScore(scammerPts(a),ap);
          burst(ap.x,ap.y,ap.z,MAG,5); freeEntity(a); cleared++; } }
      if(cleared){ renderCombo(); try{sfx.catch(state.combo);}catch(_){}
        if(state.combo>0 && state.combo%5===0){ showBanner(state.combo+" COMBO!"); } }
      try{ window.__buzz ? window.__buzz([60,40,120],"success") : (tg&&tg.HapticFeedback&&tg.HapticFeedback.notificationOccurred("success")); }catch(_){}
      // Space the NEXT boss at least 4 waves after this defeat, measured off the
      // post-reward score so the +900 (and farmed scammer points) can't immediately
      // re-trigger another boss.
      nextBossWave = (1 + Math.floor(state.score/150)) + 4;
      lastBossEnd = nowS();   // start the MIN_BOSS_GAP cooldown before the next boss can schedule
      e.dead=true; freeEntity(e); updateHUDtokens();
      return true;
    }

    /* ---- ROCKET LAUNCHER: homing rockets that seek the boss and detonate --------- */
    // The in-flight rocket is a drawn missile (nose cone + body + fins + jet flame) so it
    // reads as ordnance streaking up the lane, not a fuzzy dot. Auto-swaps to a real image
    // if images/rocket.webp exists (drop a Grok-generated PNG/WEBP there) — procedural fallback below.
    function drawFlyingRocket(x,S){
      const cx=S/2; const bw=S*0.19, topY=-S*0.34, botY=S*0.18;
      glowBG(x,S,ROCKET_COL,S*0.52,"cc");   // halo so it pops against the neon lane
      x.save(); x.translate(cx,S*0.5);
      // exhaust flame streaming out the tail
      const fg=x.createLinearGradient(0,botY,0,botY+S*0.30);
      fg.addColorStop(0,"#fff6c0"); fg.addColorStop(0.45,"#ffd23f"); fg.addColorStop(1,"rgba(255,77,46,0)");
      x.fillStyle=fg; x.beginPath();
      x.moveTo(-bw*0.72,botY); x.quadraticCurveTo(0,botY+S*0.32,bw*0.72,botY); x.closePath(); x.fill();
      // metal body
      x.shadowColor=ROCKET_COL; x.shadowBlur=S*0.09;
      const bg=x.createLinearGradient(-bw,0,bw,0);
      bg.addColorStop(0,"#9aa2bd"); bg.addColorStop(0.5,"#ffffff"); bg.addColorStop(1,"#8a91ac");
      x.fillStyle=bg; x.beginPath();
      x.moveTo(0,topY); x.quadraticCurveTo(bw,topY+S*0.12,bw,0);
      x.lineTo(bw,botY); x.lineTo(-bw,botY); x.lineTo(-bw,0);
      x.quadraticCurveTo(-bw,topY+S*0.12,0,topY); x.closePath(); x.fill();
      // nose cone
      x.shadowBlur=0; x.fillStyle=ROCKET_COL; x.beginPath();
      x.moveTo(0,topY); x.quadraticCurveTo(bw,topY+S*0.12,bw*0.55,topY+S*0.15);
      x.lineTo(-bw*0.55,topY+S*0.15); x.quadraticCurveTo(-bw,topY+S*0.12,0,topY); x.fill();
      // swept fins
      x.beginPath(); x.moveTo(-bw,botY-S*0.07); x.lineTo(-bw-S*0.12,botY+S*0.04); x.lineTo(-bw,botY); x.closePath(); x.fill();
      x.beginPath(); x.moveTo( bw,botY-S*0.07); x.lineTo( bw+S*0.12,botY+S*0.04); x.lineTo( bw,botY); x.closePath(); x.fill();
      // porthole
      x.fillStyle="#0a0618"; x.beginPath(); x.arc(0,-S*0.05,bw*0.44,0,7); x.fill();
      x.fillStyle="#7df9ff"; x.beginPath(); x.arc(0,-S*0.05,bw*0.30,0,7); x.fill();
      x.restore();
    }
    function rocketMat(){
      if(ROCKETS.mat) return ROCKETS.mat;
      ROCKETS.mat = spriteMatURL("images/rocket.webp", drawFlyingRocket);
      return ROCKETS.mat;
    }
    function getRocket(){
      let r=ROCKETS.pool.pop();
      if(!r){ r=new THREE.Sprite(rocketMat()); r.scale.set(1.5,2.6,1); scene.add(r); }
      r.visible=true; ROCKETS.live.push(r); return r;
    }
    function freeRocket(r){ const i=ROCKETS.live.indexOf(r); if(i<0) return; r.visible=false; ROCKETS.live.splice(i,1); ROCKETS.pool.push(r); }
    function clearRockets(){ for(let i=ROCKETS.live.length-1;i>=0;i--) freeRocket(ROCKETS.live[i]); ROCKETS.cd=0; }
    // Nearest hostile (SCAMMER / HONEYPOT / DECOY) ahead of the player — the homing target
    // for rockets during a NORMAL run (no boss). BULLET_KILL is the same hostile allowlist the
    // auto-cannon uses; it's defined below but initialised before this ever runs.
    function nearestEnemy(from){
      let best=null, bd=Infinity;
      for(let j=0;j<active.length;j++){ const a=active[j];
        if(!a||a.dead||!BULLET_KILL[a.type]) continue;
        const az=a.sprite.position.z;
        if(az<BULLET_CULL_Z || az>PLAYER_Z) continue;   // only reachable enemies in the field ahead
        const dx=a.sprite.position.x-from.x, dz=az-from.z, d=dx*dx+dz*dz;
        if(d<bd){ bd=d; best=a; }
      }
      return best;
    }
    function fireRocket(target){
      if(!target || ROCKETS.live.length>=ROCKETS.cap) return;
      const r=getRocket();
      r.position.set(player.position.x, player.position.y+0.3, PLAYER_Z-0.8);
      const tp=target.sprite.position;
      let dx=tp.x-r.position.x, dz=tp.z-r.position.z;
      const dl=Math.hypot(dx,dz)||1;
      r._vx=(dx/dl)*ROCKET_SPEED; r._vz=(dz/dl)*ROCKET_SPEED;
      burst(r.position.x,r.position.y,r.position.z,ROCKET_COL,6);
      // Launch whoosh. Was a single 120Hz sawtooth blip, which sat under the engine loop
      // and the music and was effectively inaudible.
      try{ (window.__sfx&&window.__sfx.rocket)?window.__sfx.rocket():blip(120,0.16,"sawtooth",0.14); }catch(_){}
    }
    // A rocket detonation shreds a scammer in one shot, scoring exactly like a caught/gunned one.
    function rocketKill(a){
      if(!a||a.dead) return;
      const ap=a.sprite.position.clone(); a.dead=true;
      state.combo++; state.kills++; run.kills++; if(state.combo>run.combo) run.combo=state.combo;
      burst(ap.x,ap.y,ap.z,ROCKET_COL,18); burst(ap.x,ap.y,ap.z,GOLD,10);
      window.addScore(scammerPts(a),ap); renderCombo();
      try{sfx.catch(state.combo);}catch(_){}
      freeEntity(a);
    }
    // Steer each live rocket toward its target — the boss if one's on the field, otherwise the
    // nearest scammer — move, trail, and detonate on contact. Re-acquires every frame so a
    // rocket re-homes onto a fresh enemy if its original target dies or is caught mid-flight.
    function updateRockets(dt){
      const boss=bossOnField();
      for(let i=ROCKETS.live.length-1;i>=0;i--){ const r=ROCKETS.live[i];
        const tgt = boss || nearestEnemy(r.position);
        // No target (launcher active but the lane's momentarily empty): coast forward, then cull.
        if(!tgt){
          r.position.x+=r._vx*dt; r.position.z+=r._vz*dt;
          const tx0=r.position.x-(r._vx/ROCKET_SPEED)*1.1, tz0=r.position.z-(r._vz/ROCKET_SPEED)*1.1;
          burst(tx0,r.position.y,tz0,ROCKET_COL,2);
          if(r.position.z<BULLET_CULL_Z-6 || Math.abs(r.position.x)>BULLET_XCULL+4) freeRocket(r);
          continue;
        }
        const bx=tgt.sprite.position.x, by=tgt.sprite.position.y, bz=tgt.sprite.position.z;
        const isBoss=(tgt.type===TYPE.RUGBOSS);
        // rotate current heading toward the target by at most ROCKET_TURN*dt (forward = -z)
        const curA=Math.atan2(r._vx,-r._vz);
        const tgtA=Math.atan2(bx-r.position.x, -(bz-r.position.z));
        let da=tgtA-curA; while(da>Math.PI)da-=2*Math.PI; while(da<-Math.PI)da+=2*Math.PI;
        const maxA=ROCKET_TURN*dt; if(da>maxA)da=maxA; else if(da<-maxA)da=-maxA;
        const na=curA+da;
        r._vx=Math.sin(na)*ROCKET_SPEED; r._vz=-Math.cos(na)*ROCKET_SPEED;
        r.position.x+=r._vx*dt; r.position.z+=r._vz*dt;
        // jet trail — emit flame + spark just behind the tail so it streaks a contrail
        const tx=r.position.x-(r._vx/ROCKET_SPEED)*1.1, tz=r.position.z-(r._vz/ROCKET_SPEED)*1.1;
        burst(tx,r.position.y,tz,"#ffd23f",2); burst(tx,r.position.y-0.15,tz,ROCKET_COL,2);
        const hitr=isBoss?ROCKET_HITR:1.5;
        if(Math.abs(r.position.x-bx)<hitr && Math.abs(r.position.z-bz)<hitr){
          burst(bx,by,bz,ROCKET_COL,isBoss?26:16); burst(bx,by,bz,GOLD,isBoss?14:8); shake(isBoss?0.7:0.4);
          // Detonation boom — bigger on the boss. Throttled: several rockets can land in the
          // same frame, and stacking full-volume booms clips the master bus into a nasty crunch.
          if(nowS()>=_lastBoomAt+0.07){ _lastBoomAt=nowS();
            try{ window.__sfx && window.__sfx.boom && window.__sfx.boom(isBoss); }catch(_){} }
          freeRocket(r);
          if(isBoss){
            let killed=false;
            for(let k=0;k<ROCKET_DMG;k++){ if(damageBoss(boss)){ killed=true; break; } }
            if(killed){ clearRockets(); return; }
          } else rocketKill(tgt);
          continue;
        }
        // cull rockets that sail well past their target without connecting
        if(r.position.z<BULLET_CULL_Z-6 || Math.abs(r.position.x)>BULLET_XCULL+4){ freeRocket(r); }
      }
    }

    // The auto-cannon fires on its own during a boss fight and the player can't aim it, so
    // it must NEVER cost them something they can't control. Tracers therefore pass through
    // the player's OWN pickups (power-ups + hearts + shield + bomb) and the friendly HODLER.
    // Everything hostile is fair game: SCAMMERs, the RUG BOSS, and — since a honeypot and a
    // fake airdrop are scams too — HONEYPOT / DECOY, which the boss sprite often hides and
    // which now pay out when shredded (see the SHOOTABLE branch below).
    // Red candles and rugger "empty promises" need no entry here: they live in THROWS, a
    // separate pool the bullet loop never iterates, so they are immune by construction.
    const BULLET_PASS = {};
    [TYPE.SHIELD,TYPE.BOMB,TYPE.PWR_SLOW,TYPE.PWR_X2,TYPE.PWR_MAG,TYPE.HEART,
     TYPE.HOLDER,TYPE.PWR_TRI,TYPE.PWR_ROCKET].forEach(t=>BULLET_PASS[t]=1);
    // Hostile entities the cannon shreds for score. Each takes 3 tracers (~0.15s at 20
    // rounds/sec) and pays exactly like catching a scammer: points + combo + kill.
    const BULLET_KILL = {};
    [TYPE.SCAMMER,TYPE.HONEYPOT,TYPE.DECOY].forEach(t=>BULLET_KILL[t]=1);

    window.updateCannon = function(dt){
      // Freeze + flush + silence the gun whenever the run isn't live (pause / menu / over).
      if(!state.running){ if(CANNON.live.length) clearBullets(); if(ROCKETS.live.length) clearRockets(); gunOff(); return; }
      const boss=bossOnField();
      if(boss){
        ensureShotBuffer();   // make sure the cheap WebAudio shot is ready for sustained fire
        CANNON.cd-=dt;
        while(CANNON.cd<=0){ fireVolley(boss); CANNON.cd+=CANNON.rate; }   // 1 or 3 bullets / volley
      } else { if(CANNON.live.length) clearBullets(); gunOff(); }
      // ROCKET LAUNCHER — fires during boss fights AND normal runs while the pickup is active.
      // Targets the boss if one's on the field, else the nearest scammer (updateRockets re-aims).
      if(nowS()<px.rocketUntil){
        ensureShotBuffer();
        const tgt = boss || nearestEnemy(player.position);
        ROCKETS.cd-=dt; while(ROCKETS.cd<=0){ fireRocket(tgt); ROCKETS.cd+=ROCKET_RATE; }
      } else ROCKETS.cd=0;
      updateRockets(dt);

      for(let i=CANNON.live.length-1;i>=0;i--){ const b=CANNON.live[i];
        b.position.x+=b._vx*dt; b.position.z+=b._vz*dt;
        if(b.position.z<BULLET_CULL_Z || Math.abs(b.position.x)>BULLET_XCULL){ freeBullet(b); continue; }
        let hit=false, bossKilled=false;
        for(let j=active.length-1;j>=0;j--){ const a=active[j]; if(!a||a.dead) continue;
          if(BULLET_PASS[a.type]) continue;
          const ax=a.sprite.position.x, az=a.sprite.position.z;
          const rad=(a.type===TYPE.RUGBOSS)?2.6:1.25;
          if(Math.abs(b.position.x-ax)<rad && Math.abs(b.position.z-az)<rad){
            if(a.type===TYPE.RUGBOSS){ bossKilled=damageBoss(a); hit=true; break; }
            // Hostiles only (SCAMMER / HONEYPOT / DECOY). Checked as an allowlist rather than
            // trusting BULLET_PASS to list every exception, so a type added later can't quietly
            // become cannon fodder and cost the player a pickup they had no way to steer to.
            if(!BULLET_KILL[a.type]) continue;
            // Three tracer rounds shred it, scoring exactly like catching a scammer.
            const ap=a.sprite.position.clone();
            if((a.bhits=(a.bhits||0)+1) < 3){ burst(ap.x,ap.y,ap.z,MAG,3); hit=true; break; }
            a.dead=true;
            state.combo++; state.kills++; run.kills++; if(state.combo>run.combo) run.combo=state.combo;
            burst(ap.x,ap.y,ap.z,MAG,12); window.addScore(scammerPts(a),ap); renderCombo();
            try{sfx.catch(state.combo);}catch(_){}
            freeEntity(a); try{sfx.catch(1);}catch(_){}
            hit=true; break;
          }
        }
        if(bossKilled) break;   // clearBullets() already flushed the pool
        // THROWN PROJECTILES — these live in THROWS, a pool the loop above never touches, so
        // they need their own pass. One tracer pops a rugger's "empty promise" bubble.
        // The boss's RED CANDLES are deliberately NOT shootable (t._lethal): they are the
        // fight's one real threat and must stay a steering dodge, or the auto-cannon would
        // simply delete the boss's whole offence for you.
        // No score: ruggers re-lob promos every ~1-2s, so paying out would be a farm.
        if(!hit){
          for(let j=THROWS.live.length-1;j>=0;j--){ const t=THROWS.live[j];
            if(t._lethal) continue;
            if(Math.abs(b.position.x-t.position.x)<1.2 && Math.abs(b.position.z-t.position.z)<1.2){
              burst(t.position.x,t.position.y,t.position.z,"#8b5cff",10);
              freeThrow(t); hit=true; break;
            }
          }
        }
        if(hit){ burst(b.position.x,b.position.y,b.position.z,GOLD,4); freeBullet(b); }
      }
    };

    /* ===================================================================== *
     *  THROWN PROJECTILES                                                     *
     *  RUG BOSS hurls bearish RED CANDLES (lethal — dodge or lose a life);    *
     *  RUGGERS lob "empty promises" buzzword bubbles (non-lethal — they only  *
     *  break your combo and shove you). Both fly from the thrower toward the   *
     *  player's lane; you dodge by steering. Own sprite pool, mirrors CANNON.  *
     * ===================================================================== */
    const THROWS = { pool:[], live:[] };
    const PROMO_WORDS = ["SOON™","WEN MOON","100X","TRUST ME","ROADMAP","NGMI"];
    const THROW_CANDLE_VZ = 22;   // world units/sec toward the player (lethal boss shot)
    const THROW_PROMO_VZ  = 17;   // slower nuisance lob from ruggers
    let _candleMat=null, _promoMats=null, candleCd=0.9, promoCd=1.2;
    let bossFightStart=0, candleCap=6;   // fight clock + live red-candle cap (both ramp the barrage)

    function candleMat(){
      if(_candleMat) return _candleMat;
      // Art: images/redcandle.webp — relative path so it loads locally AND live (the file
      // ships in the repo). The procedural red candle below is only the graceful fallback if
      // the image ever fails to load.
      _candleMat = spriteMatURL("images/redcandle.webp", (x,S)=>{
        x.clearRect(0,0,S,S); const cx=S/2;
        x.strokeStyle="#ff3b5c"; x.lineWidth=S*0.05;                 // wick
        x.beginPath(); x.moveTo(cx,S*0.07); x.lineTo(cx,S*0.93); x.stroke();
        const bw=S*0.44, bh=S*0.52, bx=cx-bw/2, by=S*0.24;          // red bearish body
        const g=x.createLinearGradient(bx,by,bx,by+bh);
        g.addColorStop(0,"#ff6480"); g.addColorStop(1,"#b70f30");
        x.fillStyle=g; x.fillRect(bx,by,bw,bh);
        x.strokeStyle="#ffd0da"; x.lineWidth=S*0.022; x.strokeRect(bx,by,bw,bh);
        x.fillStyle="#fff"; x.font="bold "+(S*0.3)+"px Orbitron, sans-serif";
        x.textAlign="center"; x.textBaseline="middle"; x.fillText("↓",cx,by+bh/2);
      }, 128);
      return _candleMat;
    }
    function promoMats(){
      if(_promoMats) return _promoMats;
      _promoMats = PROMO_WORDS.map(word => spriteMat((x,S)=>{
        x.clearRect(0,0,S,S);
        const w=S*0.84, h=S*0.56, bx=(S-w)/2, by=S*0.13, r=S*0.13;   // speech bubble
        x.fillStyle="rgba(14,9,36,0.94)"; x.strokeStyle="#8b5cff"; x.lineWidth=S*0.035;
        roundRect(x,bx,by,w,h,r); x.fill(); x.stroke();
        x.beginPath(); x.moveTo(S*0.40,by+h-2); x.lineTo(S*0.5,by+h+S*0.15); x.lineTo(S*0.60,by+h-2);
        x.closePath(); x.fillStyle="rgba(14,9,36,0.94)"; x.fill();   // bubble tail
        x.fillStyle="#cdb6ff"; x.textAlign="center"; x.textBaseline="middle";
        let fs=S*0.2; x.font="bold "+fs+"px Orbitron, sans-serif";   // shrink to fit
        while(x.measureText(word).width > w*0.84 && fs>S*0.09){ fs-=2; x.font="bold "+fs+"px Orbitron, sans-serif"; }
        x.fillText(word, S*0.5, by+h/2);
      }, 128));
      return _promoMats;
    }

    function getThrow(mat){
      let t=THROWS.pool.pop();
      if(!t){ t=new THREE.Sprite(mat); scene.add(t); } else t.material=mat;
      t.visible=true; THROWS.live.push(t); return t;
    }
    function freeThrow(t){ const i=THROWS.live.indexOf(t); if(i<0) return; t.visible=false; THROWS.live.splice(i,1); THROWS.pool.push(t); }
    function clearThrows(){ for(let i=THROWS.live.length-1;i>=0;i--) freeThrow(THROWS.live[i]); }

    // Aim a thrown sprite at the player's current lane, under-leading by `lead` (<1) so
    // steering reliably dodges it instead of it being a guaranteed hit.
    function aimThrow(t, vz, lead){
      const dz=Math.max(4, PLAYER_Z - t.position.z), eta=dz/vz;
      const aimX=THREE.MathUtils.clamp(player.position.x,-playHalfWidth,playHalfWidth);
      t._vx=((aimX - t.position.x)/eta)*lead; t._vz=vz;
    }
    function throwCandle(boss){
      if(THROWS.live.length>=candleCap) return;
      // redcandle.webp is a tall/thin portrait (aspect ~0.30) — scale to match so it reads as
      // a real candlestick, not a squashed block. Collision stays a fair fixed radius (see R).
      const t=getThrow(candleMat()); t.scale.set(0.72,2.4,1);
      const bp=boss.sprite.position; t.position.set(bp.x,1.5,bp.z+1.6);
      aimThrow(t, THROW_CANDLE_VZ, 0.85); t._lethal=true;
      burst(t.position.x,t.position.y,t.position.z,RED,6);
      try{ window.__buzz && window.__buzz([20],"warning"); }catch(_){}
    }
    function throwPromo(rug){
      if(THROWS.live.length>=6) return;
      const t=getThrow(promoMats()[(Math.random()*_promoMats.length)|0]); t.scale.set(2.4,1.6,1);
      const rp=rug.sprite.position; t.position.set(rp.x,1.5,rp.z+0.6);
      aimThrow(t, THROW_PROMO_VZ, 0.8); t._lethal=false; rug._threw=true;
    }

    window.updateThrows = function(dt){
      if(!state.running){ if(THROWS.live.length) clearThrows(); candleCd=0.9; promoCd=1.2; return; }
      const boss=bossOnField();

      // boss red-candle barrage (only while a boss lives) — ESCALATES the longer the fight drags
      // on. Ramp is keyed to REAL elapsed time (nowS), not slowed dt, so parking in SLOW-MO to
      // farm easy score doesn't slow the incoming candles: camp longer, get buried in red.
      if(boss){
        const ramp=Math.min(1,(nowS()-bossFightStart)/30);   // 0 -> 1 over the first 30s of the fight
        candleCap=Math.round(6+ramp*8);                      // more candles allowed in flight (6 -> 14)
        candleCd-=dt;
        if(candleCd<=0){
          throwCandle(boss);
          if(ramp>0.6) throwCandle(boss);                    // late-fight double volley
          candleCd=(1.5-ramp*1.0)+Math.random()*(0.9-ramp*0.7);   // interval tightens 1.5s -> ~0.5s
        }
      } else { candleCd=0.9; candleCap=6; }

      // rugger "empty promises" — one mid-field rugger that hasn't thrown yet lobs a bubble
      promoCd-=dt;
      if(promoCd<=0){
        let rug=null;
        for(const a of active){
          if(a && !a.dead && a.type===TYPE.SCAMMER && a._rugger && !a._threw){
            const z=a.sprite.position.z;
            if(z>SPAWN_Z+6 && z<PLAYER_Z-6){ rug=a; break; }
          }
        }
        if(rug){ throwPromo(rug); promoCd=1.0+Math.random()*1.0; } else promoCd=0.4;
      }

      // advance + player collision
      const R=1.35;
      for(let i=THROWS.live.length-1;i>=0;i--){ const t=THROWS.live[i];
        t.position.x+=t._vx*dt; t.position.z+=t._vz*dt;
        if(t.position.z>PLAYER_Z+2){ freeThrow(t); continue; }          // sailed past
        if(Math.abs(t.position.z-PLAYER_Z)<R && Math.abs(t.position.x-player.position.x)<R){
          const p=t.position.clone();
          if(t._lethal){
            if(shieldActive){ shieldActive=false; burst(p.x,p.y,p.z,TEAL,14); popup(p,"SHIELD!",TEAL); try{sfx.power();}catch(_){} }
            else { popup(p,"RED CANDLE!",RED); flashColor("rgba(255,59,92,.4)",0.5); loseLife(p); }
          } else {
            if(state.combo>0){ state.combo=0; renderCombo(); }         // empty promise breaks your combo
            burst(p.x,p.y,p.z,"#8b5cff",10); popup(p,"EMPTY PROMISE","#b79bff"); shake(0.35);
            try{ window.__buzz && window.__buzz([25],"warning"); }catch(_){}
          }
          freeThrow(t); continue;
        }
      }
    };

    window.resolve = function(e){
      const p=e.sprite.position.clone();
      const dropMult = (window.__dropMult||1) * tierDropMult();

      if(e.type===TYPE.RUGBOSS){
        // TEST MECHANIC: you can NO LONGER kill the boss by ramming it. Body contact
        // costs a life (or eats a shield); the boss bounces back to spawn depth so the
        // auto-cannon (see AUTO-CANNON below) can keep shredding it. The ONLY way to
        // defeat the rug boss now is to gun it down via damageBoss().
        if(shieldActive){
          shieldActive=false; burst(p.x,p.y,p.z,TEAL,14); popup(p,"SHIELD ATE THE RAM",TEAL);
          try{sfx.power();}catch(_){}
        } else {
          popup(p,"DON'T RAM THE RUG!",RED); loseLife(p);
        }
        // shove it back undefeated — DO NOT damage, DO NOT free
        e.sprite.position.z = SPAWN_Z-4; e.prevZ=e.sprite.position.z; e._nm=false;
        return;
      }

      if(e.type===TYPE.HEART){               // TEST: extra-life pickup
        state.lives++; renderLives();
        burst(p.x,p.y,p.z,RED,18); popup(p,"+1 LIFE",RED); showBanner("EXTRA LIFE");
        try{sfx.power();}catch(_){}
        try{ window.__buzz && window.__buzz([30,20,40],"success"); }catch(_){}
        e.dead=true; freeEntity(e); return;
      }

      if(e.type===TYPE.HONEYPOT){            // looked grabbable, stings
        if(shieldActive){ shieldActive=false; burst(p.x,p.y,p.z,TEAL,12); popup(p,"TRAP BLOCKED",TEAL); try{sfx.power();}catch(_){} }
        else { popup(p,"HONEYPOT!",RED); loseLife(p); }
        e.dead=true; freeEntity(e); return;
      }
      if(e.type===TYPE.DECOY){               // fake airdrop, kills combo
        state.combo=0; renderCombo(); burst(p.x,p.y,p.z,CYAN,14);
        popup(p,"FAKE AIRDROP",CYAN); try{sfx.hit&&blip(220,0.18,"sawtooth",0.12);}catch(_){}
        e.dead=true; freeEntity(e); return;
      }
      const _bm=(window.__buffMult||1);   // OVERDRIVE CORE extends every power-up
      if(e.type===TYPE.PWR_SLOW){ px.slowUntil=nowS()+4.5*_bm; burst(p.x,p.y,p.z,"#7df9ff",16); popup(p,"SLOW-MO",CYAN); showBanner("SLOW-MO"); try{sfx.power();}catch(_){} e.dead=true; freeEntity(e); return; }
      if(e.type===TYPE.PWR_X2){ px.x2Until=nowS()+6*_bm; burst(p.x,p.y,p.z,GOLD,16); popup(p,"SCORE ×2",GOLD); showBanner("DOUBLE SCORE"); try{sfx.power();}catch(_){} e.dead=true; freeEntity(e); return; }
      if(e.type===TYPE.PWR_MAG){ px.magUntil=nowS()+5*_bm; burst(p.x,p.y,p.z,MAG,16); popup(p,"MAGNET",MAG); showBanner("SCAMMER MAGNET"); try{sfx.power();}catch(_){} e.dead=true; freeEntity(e); return; }
      if(e.type===TYPE.PWR_TRI){
        // Wallet-verified $XZILLA holders get the longer window. Exact seconds (no _bm) so the
        // 10s / 15s the player was promised is what they get.
        const dur = window.__holderVerified ? TRI_SECS_HOLDER : TRI_SECS;
        px.triUntil=nowS()+dur; burst(p.x,p.y,p.z,TRI_COL,20); popup(p,"TRI-CANNON",TRI_COL);
        showBanner("TRI-CANNON "+dur+"s"); try{sfx.power();}catch(_){}
        try{ window.__buzz && window.__buzz([40,25,60],"success"); }catch(_){}
        e.dead=true; freeEntity(e); return;
      }
      if(e.type===TYPE.PWR_ROCKET){
        // Exact seconds (no _bm) so the 8s / 12s the player was promised is what they get.
        const dur = window.__holderVerified ? ROCKET_SECS_HOLDER : ROCKET_SECS;
        px.rocketUntil=nowS()+dur; ROCKETS.cd=0;   // first rocket flies on the next cannon tick
        burst(p.x,p.y,p.z,ROCKET_COL,20); popup(p,"ROCKET LAUNCHER",ROCKET_COL);
        showBanner("ROCKET LAUNCHER "+dur+"s"); try{sfx.power();}catch(_){}
        try{ window.__buzz && window.__buzz([50,30,80],"success"); }catch(_){}
        e.dead=true; freeEntity(e); return;
      }

      if(e.type===TYPE.SCAMMER){
        state.combo++; state.kills++; run.kills++; if(state.combo>run.combo) run.combo=state.combo;
        try{sfx.catch(state.combo);}catch(_){}
        burst(p.x,p.y,p.z,MAG,14); window.addScore(scammerPts(e),p); renderCombo();
        const tok=Math.round(2*dropMult); econ.tokens+=tok; run.earned+=tok; pop=1.22;
        if(state.combo>0 && state.combo%5===0){ showBanner(state.combo+" COMBO!"); flashColor("rgba(57,255,122,.35)",0.5); shake(0.5); }
        try{ if(tg&&tg.HapticFeedback) tg.HapticFeedback.impactOccurred("light"); }catch(_){}
        e.dead=true; freeEntity(e); updateHUDtokens(); return;
      }
      if(e.type===TYPE.HOLDER){
        if(shieldActive){ shieldActive=false; burst(p.x,p.y,p.z,TEAL,12); popup(p,"BLOCKED!",TEAL); try{sfx.power();}catch(_){} }
        else loseLife(p);
        e.dead=true; freeEntity(e); return;
      }
      if(e.type===TYPE.SHIELD){ shieldActive=true; burst(p.x,p.y,p.z,TEAL,12); popup(p,"SHIELD!",TEAL); try{sfx.power();}catch(_){} e.dead=true; freeEntity(e); return; }
      if(e.type===TYPE.BOMB){
        try{sfx.power();}catch(_){} burst(p.x,p.y,p.z,GOLD,18); shake(0.7); flashColor("rgba(255,210,63,.4)",0.6); popup(p,"LIQUIDATED!",GOLD);
        try{ window.__buzz && window.__buzz([30,20,60],"impact"); }catch(_){}
        for(let i=active.length-1;i>=0;i--){ const a=active[i]; if(a!==e&&a.type===TYPE.SCAMMER&&!a.dead){
          a.dead=true; const ap=a.sprite.position.clone(); burst(ap.x,ap.y,ap.z,MAG,6);
          // the bomb now BUILDS your combo (each cleared scammer counts) instead of wasting it —
          // combo++ before addScore so every subsequent kill also banks at the higher multiplier.
          state.combo++; state.kills++; run.kills++; if(state.combo>run.combo) run.combo=state.combo;
          window.addScore(scammerPts(a),ap); const tok=Math.round(2*dropMult); econ.tokens+=tok; run.earned+=tok;
          freeEntity(a); } }
        renderCombo();
        e.dead=true; freeEntity(e); updateHUDtokens(); return;
      }
      // fallback
      e.dead=true; freeEntity(e);
    };

    /* ===================================================================== *
     *  SECOND WIND — cheat death once per run (elite upgrade)                 *
     *  Intercept the killing blow: instead of dropping to 0 HP and ending the *
     *  run, spend the charge to survive the hit and pop a fresh shield.        *
     * ===================================================================== */
    const _loseLife = window.loseLife;
    window.loseLife = function(worldPos){
      if(reviveAvail && state.running && state.lives<=1){
        reviveAvail=false;
        state.combo=0; renderCombo(); renderLives();   // keep current (1) HP — the fatal hit is negated
        shieldActive=true;                              // and hand back a shield to recover
        if(worldPos){ burst(worldPos.x,worldPos.y,worldPos.z,GOLD,24); burst(worldPos.x,worldPos.y,worldPos.z,TEAL,16); popup(worldPos,"SECOND WIND!",GOLD); }
        showBanner("SECOND WIND"); flashColor("rgba(255,210,63,.5)",0.85); shake(1.1);
        try{sfx.power();}catch(_){}
        try{ window.__buzz && window.__buzz([50,30,90],"success"); }catch(_){}
        return;
      }
      _loseLife(worldPos);
    };

    /* ===================================================================== *
     *  FRAME HOOK — power-up effects + speed control + boss flair             *
     * ===================================================================== */
    const _origFrame = window.__frame;
    let _rugBarEl = null;          // (P4) cached — was a getElementById on every frame
    window.__frame = function(dt){
      if(_origFrame) _origFrame(dt);
      const t=nowS();
      // WORLD SPEED — both scalers ride window.__speedMult, which the base loop folds into
      // state.speed at the source (index.html's ramp line). That placement is load-bearing:
      // the ramp recomputes state.speed from CFG every frame BEFORE the entity loop reads it,
      // so scaling state.speed from this hook (which runs at the END of the frame) is wiped
      // before it can move anything. SLOW-MO used to do exactly that -- `state.speed *= 0.5`
      // right here -- which is why it only ever slowed the grid scroll and the engine pitch
      // while the scammers kept rushing in at full speed.
      //   BOSS_SLOW: world drops to half of whatever the ramp had reached when the boss
      //     landed, so a gear-12 fight slows proportionally to a gear-1 one.
      //   SLOWMO:    the power-up, now actually slowing the hazards it always claimed to.
      // They multiply, so slow-mo during a boss fight lands at 0.25x. Eased rather than
      // snapped so neither one feels like hitting a wall.
      // NOTE: BOSS_SLOW restores a world slow-down an earlier build removed over iOS
      // boss-fight lag. Unlike that version it never touches CFG, so no scaled-CFG state
      // can leak into the next run.
      const _spdTarget = (bossOnField() ? BOSS_SLOW : 1) * (powActive(px.slowUntil) ? SLOWMO : 1);
      _speedMult += (_spdTarget - _speedMult) * Math.min(1, dt*3.5);
      window.__speedMult = _speedMult;
      // Guard: if a prior build left CFG scaled, restore it once.
      if(CFG._baseSave!==undefined){
        CFG.baseSpeed=CFG._baseSave; CFG.speedRampPerSec=CFG._rampSave; CFG._baseSave=undefined;
      }
      // magnet: ease scammers toward the player's lane
      if(powActive(px.magUntil)){
        for(const a of active){ if(a.type===TYPE.SCAMMER && !a.dead){
          a.sprite.position.x += (player.position.x - a.sprite.position.x)*0.06; } }
      }
      // CHASE: keep the boss weaving on x and PINNED a fixed distance ahead on z.
      // The base loop (index.html) already nudged its z toward the player this frame; we
      // pull it back to CHASE_Z so the gap stays constant. On spawn it flies in from far
      // ahead (SPAWN_Z-6), then hard-locks. prevZ is re-synced every frame so the base
      // loop's catch/ram test can never fire (the boss never crosses the player line).
      let _boss=null;
      for(const a of active){ if(a.type===TYPE.RUGBOSS){
        _boss=a;
        // FRANTIC WEAVE — wide primary sweep across most of the lane plus a faster
        // secondary wobble, so the fleeing whale juke-dodges instead of drifting on a
        // lazy metronome. Kept just inside playHalfWidth (~3) so it stays gunnable and
        // its candles stay dodgeable.
        a.sprite.position.x = Math.sin(t*2.9)*2.2 + Math.sin(t*4.6)*0.55;
        if(a.sprite.position.z < CHASE_Z-0.4){
          a.sprite.position.z += (CHASE_Z-a.sprite.position.z)*Math.min(1,dt*CHASE_IN);  // fly in
        } else {
          a.sprite.position.z = CHASE_Z;   // locked ahead
        }
        a.prevZ = a.sprite.position.z;
      } }
      // #tire-anim (boss) — cycle the 2-frame sheet so the monster-truck treads spin.
      // Speed-linked like the player's tires, so they blur faster as the run ramps up.
      // Guarded on repeat.x<1 so it no-ops until the sheet texture has actually loaded.
      if(_boss){
        const _bt=matRug.map, B=window.__BOSSSHEET;
        if(_bt && B && _bt.repeat && _bt.repeat.x<1){
          _bossTireAcc += dt * (state.running?(state.speed||6):3.0) * 3.0;
          const f=((Math.floor(_bossTireAcc)%B.frames)+B.frames)%B.frames;
          _bt.offset.x=(f%B.cols)/B.cols; _bt.offset.y=1-(((f/B.cols)|0)+1)/B.rows;
        }
      } else _bossTireAcc=0;
      // JET/THRUSTER TRAIL — hot exhaust streaming off the fleeing whale back toward the
      // pursuer (+z, past the camera). Rate-capped so it stays cheap on mobile. Only runs
      // once the boss has flown in and locked (skips the streaky fly-in).
      if(_boss && _boss.sprite.position.z >= CHASE_Z-0.4 && window.emitParticle){
        _jetCd -= dt;
        while(_jetCd <= 0){
          _jetCd += 0.028;   // ~36 puffs/sec
          const bx=_boss.sprite.position.x, bz=_boss.sprite.position.z;
          const col = (Math.random()<0.5) ? "#ff7a1f" : RED;   // orange core / rug-red flame
          window.emitParticle(
            bx + (Math.random()-0.5)*1.6,          // spread across the whale's tail
            1.05 + Math.random()*0.7,               // just below body height
            bz + 1.8 + Math.random()*0.6,           // emit behind it, toward the camera
            col, 0.9,
            (Math.random()-0.5)*3.2,                // slight lateral scatter
            (Math.random()-0.5)*1.6,                // slight vertical scatter
            10 + Math.random()*6,                   // vz: blast back past the player
            0.45 + Math.random()*0.15);             // life
        }
      } else { _jetCd = 0; }
      // BOSS AURA — pin the halo on the truck and pulse it; hide when no boss.
      /* BOSS AURA — OFF. It was meant to separate the truck's dark silhouette from the neon
       * skyline, but at scale.x*1.9 it is nearly twice the truck's width, ADDITIVE, and
       * pulsing at 0.42-0.58 opacity, so it adds light straight over the body and edges and
       * reads as a bubble sitting on the boss rather than a rim behind it. Twice tuned
       * already (bright core removed, then re-centred) and it still veiled the art, so the
       * halo is disabled rather than tuned a third time. To bring it back, restore the
       * block below and start well under scale*1.4 with opacity < 0.25. */
      const _glow=bossGlowSprite();
      if(_glow.visible) _glow.visible=false;
      // self-heal: if the boss left the screen un-defeated (dodged), its health bar must
      // not linger — hide it whenever there is no boss on the field.
      // (P4) was: a getElementById AND a fresh .some() closure allocated every frame, to
      // answer a question we already know the answer to. The element is cached (retried
      // while null, so a lazily-created bar still binds), and the scan reuses the _boss
      // found above — the manual fallback loop only runs for the legacy TYPE.BOSS, and
      // only on the rare frames where the bar is actually on screen.
      { const bar=_rugBarEl||(_rugBarEl=$("rugBar"));
        if(bar && bar.style.display!=="none" && !_boss){
          let any=false;
          for(let i=0;i<active.length;i++){ const a=active[i];
            if(a && (a.type===TYPE.RUGBOSS||a.type===TYPE.BOSS)){ any=true; break; } }
          if(!any) hideRugBar();
        } }
      // TEST: auto-cannon — fire + advance + collide tracer rounds while a boss lives
      if(window.updateCannon) window.updateCannon(dt);
      if(window.updateThrows) window.updateThrows(dt);
      // active-buff HUD ticker
      renderBuffs(t);
    };

    /* small buff indicator under the bag readout ----------------------------- */
    // P2 already stopped the per-frame innerHTML write. (P4) stops the per-frame WORK that
    // fed it: a getElementById, a parts[] array and three template strings were still being
    // built 60x/sec purely to be compared and thrown away — on the vast majority of frames
    // no buff is even active. Fast-path that case out before allocating anything, and cache
    // the row element (it is now created lazily, on the first frame a buff actually exists).
    // Measured saving is small (~0.1us/frame); this is here for the same reason as the
    // scratch profile above — it is cheaper AND simpler, not because it was a hot spot.
    let _buffEl=null;
    function renderBuffs(t){
      const sA=powActive(px.slowUntil), sB=powActive(px.x2Until), sC=powActive(px.magUntil);
      if(!sA && !sB && !sC){
        if(_buffEl && _buffEl._lastHtml!==""){ _buffEl.innerHTML=""; _buffEl._lastHtml=""; _buffEl.style.display="none"; }
        return;
      }
      let el=_buffEl;
      if(!el){
        el=$("buffRow");
        if(!el){ el=document.createElement("div"); el.id="buffRow";
          el.style.cssText="position:fixed;right:14px;top:118px;z-index:21;display:flex;gap:6px;"+
            "font:9px 'Press Start 2P',monospace;pointer-events:none";
          document.body.appendChild(el); }
        _buffEl=el;
      }
      let html="";
      if(sA) html  = '<span style="color:#7df9ff">⏳'+Math.ceil(px.slowUntil-t)+'</span>';
      if(sB) html += (html?" ":"")+'<span style="color:'+GOLD+'">✕2 '+Math.ceil(px.x2Until-t)+'</span>';
      if(sC) html += (html?" ":"")+'<span style="color:'+MAG+'">🧲'+Math.ceil(px.magUntil-t)+'</span>';
      if(html!==el._lastHtml){
        el.innerHTML=html; el._lastHtml=html;
        el.style.display="flex";
      }
    }

    /* ===================================================================== *
     *  WIDEN CATCH on combo upgrade — patch the loop's catch test indirectly  *
     *  The base loop uses a fixed catchX; we can't edit it, but we can pull    *
     *  near-miss scammers in slightly when DIAMOND GRIP is owned.             *
     * ===================================================================== */
    (function(){
      // ALWAYS install the hook and read __catchBonus LIVE each frame. The old code captured
      // grip ONCE at load and skipped installing the hook when it was 0 — so DIAMOND GRIP bought
      // (or upgraded) mid-session did nothing until a page reload. Now it applies immediately.
      const prevF = window.__frame;
      window.__frame = function(dt){
        prevF(dt);
        const grip = window.__catchBonus||0;
        if(grip<=0) return;
        // nudge scammers near the catch line toward the player a touch
        for(const a of active){ if(a.type===TYPE.SCAMMER && !a.dead){
          const z=a.sprite.position.z;
          if(z>PLAYER_Z-3 && z<PLAYER_Z+3){
            const dx=player.position.x-a.sprite.position.x;
            if(Math.abs(dx) < 1.85+grip) a.sprite.position.x += dx*0.18;
          }
        }}
      };
    })();

    /* ===================================================================== *
     *  RUN SETUP — head-start shield + apply upgrades each run                *
     * ===================================================================== */
    const _beforeRun = (typeof beforeRun==="function") ? beforeRun : null;
    function set2BeforeRun(){
      applyUpgrades();
      renderLives();                 // reflect new max HP
      px.slowUntil=px.x2Until=px.magUntil=px.triUntil=px.rocketUntil=0; _rocketThisFight=false; _rocketNormAt=nowS()+ROCKET_NORM_GAP; rugPending=false; nextBossWave=4; rugWarnUntil=0; lastBossEnd=0; window.__rugWarn=false; window.__rugBossAt=0;
      hideRugBar();
      if(lvl("start")>0){ shieldActive=true; }
      if(lvl("warm")>0){ state.combo = 1 + lvl("warm"); if(state.combo>run.combo) run.combo=state.combo; renderCombo(); }   // WARM ENGINE: open at combo ×(1+lvl)
      reviveAvail = lvl("revive")>0;                 // SECOND WIND: arm one charge per run
      if(lvl("nitro")>0){ px.x2Until = nowS() + 8 + (lvl("nitro")-1)*4; }   // NITRO LAUNCH: 8s +4s/lvl opening SCORE ×2
    }
    ["startBtn","retryBtn"].forEach(id=>{ const b=$(id); if(b) b.addEventListener("click", set2BeforeRun); });

    /* ===================================================================== *
     *  UPGRADES TAB — new panel injected into the existing tab system         *
     * ===================================================================== */
    // add a tab button + panel element if not present
    (function ensureUpgradeTab(){
      const bar=$("tabbar"); if(bar && !bar.querySelector('[data-tab="UPGRADES"]')){
        const btn=document.createElement("button");
        btn.className="tab"; btn.dataset.tab="UPGRADES"; btn.textContent="UPGRADE";
        // insert after SKINS
        bar.appendChild(btn);
        btn.addEventListener("click", ()=>showTab("UPGRADES"));
      }
      if(!$("upgradesPanel")){
        const pan=document.createElement("div");
        pan.id="upgradesPanel"; pan.className="overlay panel hidden";
        pan.innerHTML='<div class="panelInner" id="upgradesInner"></div>';
        document.body.appendChild(pan);
      }
      PANELS.UPGRADES = "upgradesPanel";
    })();

    // hook showTab so UPGRADES renders (wrap the in-scope showTab)
    const _showTab = showTab;
    showTab = function(name){
      if(name==="UPGRADES"){
        document.querySelectorAll("#tabbar .tab").forEach(b=>b.classList.toggle("on", b.dataset.tab===name));
        $("startScreen").classList.add("hidden");
        Object.values(PANELS).forEach(id=>{ const el=$(id); if(el) el.classList.add("hidden"); });
        $("gameOverScreen").classList.add("hidden");
        $("upgradesPanel").classList.remove("hidden");
        renderUpgrades();
        return;
      }
      _showTab(name);
    };
    // NOTE: the original tab buttons are already wired at "// tab bar wiring" above;
    // that handler closes over `showTab`, which we just reassigned, so it routes
    // through the wrapped version automatically. The UPGRADE button is wired in
    // ensureUpgradeTab(). Re-binding here would add a 2nd listener and fire showTab
    // (a full panel re-render) twice per tab tap — so it is intentionally omitted.

    function renderUpgrades(){
      const tier=tierFor(econ.holdings);
      $("upgradesInner").innerHTML =
        '<h2 class="pnl-title" style="border-color:'+GOLD+'">UPGRADE TREE · '+fmt(econ.tokens)+' XP</h2>'+
        '<div class="sub">Holdings tier <b style="color:'+tier.c+'">'+tier.l+'</b> · '+tier.m+'× score · '+
          (tierDropMult()).toFixed(2)+'× token drops</div>'+
        UPGRADES.map((u,i)=>{
          const cur=lvl(u.id), maxed=cur>=u.max, cost=upgCost(u);
          const can=!maxed && econ.tokens>=cost;
          const accent = u.elite?MAG:GOLD;
          // inject an "ELITE" divider just before the first elite upgrade
          const head = (u.elite && (i===0 || !UPGRADES[i-1].elite))
            ? '<h3 class="pnl-title" style="border-color:'+MAG+';margin-top:16px;color:'+MAG+'">⚡ ELITE UPGRADES</h3>' : '';
          const pips = Array.from({length:u.max},(_,k)=>
            '<span style="display:inline-block;width:14px;height:8px;margin-right:3px;border-radius:3px;'+
            'background:'+(k<cur?accent:"#2a2150")+'"></span>').join("");
          return head + '<div class="mrow'+(maxed?' done':'')+(u.elite?'" style="border-color:'+(maxed?TEAL:MAG):'')+'">'+
            '<div class="mtop"><span>'+(u.elite?'⚡ ':'')+u.name+'</span><b style="color:'+(maxed?TEAL:accent)+'">'+
              (maxed?"MAX":fmt(cost)+" XP")+'</b></div>'+
            '<div class="msub" style="text-align:left">'+u.desc+'</div>'+
            '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px">'+
              '<div>'+pips+'</div>'+
              '<button class="sbtn'+(can?'':' ')+'" data-upg="'+u.id+'" '+(can?'':'disabled')+
                ' style="flex:0 0 auto;min-width:96px;border-color:'+(can?GOLD:"#444")+';color:'+(can?GOLD:"#666")+
                (maxed?';opacity:.5':'')+'">'+(maxed?"OWNED":"BUY")+'</button>'+
            '</div></div>';
        }).join("");
      $("upgradesInner").querySelectorAll("[data-upg]").forEach(btn=>{
        btn.onclick=()=>{
          const u=UPGRADES.find(x=>x.id===btn.dataset.upg);
          if(!u || lvl(u.id)>=u.max) return;
          const cost=upgCost(u);
          if(econ.tokens<cost){ toast("Not enough XP",RED); return; }
          econ.tokens-=cost; upg[u.id]++; saveUpg(); saveEcon();
          applyUpgrades(); updateHUDtokens(); renderUpgrades();
          toast("Upgraded "+u.name+" → Lv"+lvl(u.id),GOLD);
        };
      });
    }

    /* ===================================================================== *
     *  LEADERBOARD — structured + Telegram social hooks (read-only)           *
     *  Real cross-player sync needs a backend you own; this keeps a clean,    *
     *  weekly-resettable local board and an invite/share surface that a real  *
     *  server endpoint can drop into later.                                   *
     * ===================================================================== */
    const _renderLeaderboard = renderLeaderboard;
    renderLeaderboard = function(){
      _renderLeaderboard();
      const host=$("leaderboardInner"); if(!host) return;

      // GLOBAL TOP 10 — the leaderboard. Prepended above the milestones ladder.
      if(lbApi() && !host.querySelector("#lbTop")){
        const box=document.createElement("div"); box.id="lbTop";
        box.innerHTML='<h2 class="pnl-title" style="border-color:'+CYAN+';margin-top:4px;">TOP 10 DEGENS</h2>'+
          '<div class="sub" id="lbTopList">Loading global rankings…</div>';
        host.insertBefore(box, host.firstChild);
        // no-store: always pull the freshest board so a cached response can't show stale order
        fetch(lbApi()+"/top", { cache:"no-store" }).then(r=>r.json()).then(d=>{
          const list=(d && d.top) || []; const el=$("lbTopList"); if(!el) return;
          if(!list.length){ el.textContent="No scores yet — be the first to rank!"; return; }
          const dupes = dupeNamesIn(list);
          el.className=""; el.innerHTML=list.map((e,i)=>{
            const t  = titleForScore(e.score);   // each player's rank milestone, derived from their score
            return '<div class="lrow'+(isMe(e)?' you':'')+'">'+
              '<span class="lrank">#'+(i+1)+'</span>'+
              '<span class="lname">'+boardName(e,dupes)+holderBadge(e)+
                (t?' · <span style="color:'+GOLD+'">'+t.name+'</span>':'')+'</span>'+
              '<b>'+fmt(e.score)+'</b></div>';
          }).join("");
        }).catch(()=>{ const el=$("lbTopList"); if(el) el.textContent="Global rankings unavailable — retry later."; });
      }

      // TOP INVITERS board + the player's own invite tally
      if(lbApi() && !host.querySelector("#lbRefTop")){
        const myInv = (store.get("xz_ref_count",0)|0);
        const box=document.createElement("div"); box.id="lbRefTop";
        box.innerHTML='<h2 class="pnl-title" style="border-color:'+GOLD+';margin-top:14px;">TOP INVITERS</h2>'+
          (myInv>0
            ? '<div class="sub" style="color:'+TEAL+'">You’ve invited '+myInv+' friend'+(myInv>1?'s':'')+' · +'+fmt(myInv*3000)+' XP earned</div>'
            : '<div class="sub">Invite friends below to climb this board!</div>')+
          '<div class="sub" id="lbRefList">Loading…</div>';
        const lbTopEl=$("lbTop");
        if(lbTopEl && lbTopEl.nextSibling) host.insertBefore(box, lbTopEl.nextSibling); else host.insertBefore(box, host.firstChild);
        fetch(lbApi()+"/refer-top",{cache:"no-store"}).then(r=>r.json()).then(d=>{
          const list=(d&&d.top)||[]; const el=$("lbRefList"); if(!el) return;
          if(!list.length){ el.textContent="No invites yet — be the first!"; return; }
          el.className=""; el.innerHTML=list.map((e,i)=>
            '<div class="lrow"><span class="lrank">#'+(i+1)+'</span><span class="lname">'+escapeHtml(e.name)+'</span><b>'+e.count+' 🦖</b></div>').join("");
        }).catch(()=>{ const el=$("lbRefList"); if(el) el.textContent="Inviter board unavailable."; });
      }

      // append a social strip below the existing rankings
      if(host.querySelector("#lbSocial")) return;
      const wrap=document.createElement("div"); wrap.id="lbSocial";
      wrap.style.cssText="margin-top:14px;display:flex;flex-direction:column;gap:8px";
      wrap.innerHTML=
        '<div class="sub" style="margin-top:2px">PLAY WITH FRIENDS</div>'+
        '<button class="btn secondary" id="lbInvite" style="font-size:11px;padding:13px">INVITE A DEGEN · +3000 XP / FRIEND</button>'+
        '<button class="btn secondary" id="lbShare" style="font-size:11px;padding:13px">SHARE MY RANK</button>'+
        (lbApi() ?
          '<div class="sub" style="margin-top:6px">POST THE LEADERBOARD</div>'+
          '<button class="btn secondary" id="lbPostTg" style="font-size:11px;padding:13px">📣 POST TOP 10 TO TELEGRAM</button>'+
          '<button class="btn secondary" id="lbPostX" style="font-size:11px;padding:13px">𝕏 POST TOP 5 TO X</button>'
          : '<div class="sub" style="opacity:.7">Global TOP 10 activates once the $XZILLA leaderboard backend is connected.</div>');
      host.appendChild(wrap);
      $("lbInvite").onclick=inviteFriends;
      $("lbShare").onclick=shareScore;
      if($("lbPostTg")) $("lbPostTg").onclick=()=>postLeaderboard("tg");
      if($("lbPostX"))  $("lbPostX").onclick =()=>postLeaderboard("x");
    };

    /* weekly local reset so the board feels alive ---------------------------- */
    (function weeklyReset(){
      const wk = Math.floor(Date.now()/6048e5); // ~1 week buckets
      if(store.get("xz_lb_week",null)!==wk){
        store.set("xz_lb_week", wk);
        // new week → reset the weekly best so the weekly board starts fresh. The
        // all-time best (myBest) is untouched. A real backend would sync rivals here.
        weekBest = 0; store.set("xz_weekbest", 0);
      }
    })();

  /* === ANCHOR: WEB3 === */
    /* ===================================================================== *
     *  WALLET PANEL — read-only live balance hook (display scaffolding)       *
     *  Adds a "Refresh on-chain balance" affordance. The actual signed        *
     *  read/claim/transfer must be done by you against your mint + RPC; this  *
     *  wires the display path so it lights up when that's connected.          *
     * ===================================================================== */
    const _renderWallet = renderWallet;
    renderWallet = function(){
      _renderWallet();
      const host=$("walletInner"); if(!host || host.querySelector("#wOnchain")) return;
      const box=document.createElement("div"); box.id="wOnchain"; box.className="wcard";
      box.style.marginTop="10px";
      box.innerHTML=
        '<div class="wrow"><span>ON-CHAIN BALANCE</span><b id="wChainVal">—</b></div>'+
        '<button class="sbtn" id="wRefresh" style="border-color:'+CYAN+';color:'+CYAN+'">REFRESH ON-CHAIN BALANCE</button>'+
        '<div class="sub" style="opacity:.7">Reads $XZILLA from your connected wallet. Rewards remain off-chain until the claim contract is connected.</div>';
      host.appendChild(box);
      // seed with the last known verified balance if we already have one
      if(window.XZWallet && typeof window.XZWallet.balance==="number"){
        $("wChainVal").textContent=fmt(window.XZWallet.balance)+" $XZILLA";
      }
      $("wRefresh").onclick=async()=>{
        const v=$("wChainVal"); v.textContent="…";
        try{
          if(!window.XZWallet){ v.textContent="Loading…"; return; }
          if(!window.XZWallet.address){ window.XZWallet.connect(); v.textContent="Connect wallet…"; return; }
          await window.XZWallet.refresh();                       // re-reads via the Worker /balance endpoint
          const b=window.XZWallet.balance;
          v.textContent=(typeof b==="number") ? (fmt(b)+" $XZILLA") : "Read failed";
          if(typeof b==="number"){ econ.holdings=Math.round(b); saveEcon(); updateVip(); _renderWallet(); toast("Balance synced",CYAN); }
        }catch(e){ v.textContent="Read failed"; toast("On-chain read failed",RED); }
      };
    };


    /* ===================================================================== *
     *  LIVELINESS + KILL FX  — make enemies breathe and pop, and give every  *
     *  catch a satisfying color-coded shockwave.                             *
     * ===================================================================== */
    (function aliveAndKillFX(){
      if (typeof THREE === "undefined") return;
      const TAU = Math.PI*2;

      /* ---- shockwave ring texture (soft additive donut) ---- */
      const ringTex = makeTex((x,S)=>{
        x.clearRect(0,0,S,S); const cx=S/2;
        const g=x.createRadialGradient(cx,cx,S*0.30,cx,cx,S*0.49);
        g.addColorStop(0.0,"rgba(255,255,255,0)");
        g.addColorStop(0.62,"rgba(255,255,255,0)");
        g.addColorStop(0.80,"rgba(255,255,255,1)");
        g.addColorStop(0.92,"rgba(255,255,255,0.55)");
        g.addColorStop(1.0,"rgba(255,255,255,0)");
        x.fillStyle=g; x.beginPath(); x.arc(cx,cx,S*0.49,0,TAU); x.fill();
      },256);
      const rings=[];
      const _ringFree=[];   // (P3) pool of reusable ring sprites — recolored on reuse, never disposed
      function ring(p,color,scale,life){
        let s=_ringFree.pop();
        if(!s){ s=new THREE.Sprite(new THREE.SpriteMaterial({ map:ringTex, transparent:true,
          blending:THREE.AdditiveBlending, depthWrite:false })); scene.add(s); }
        s.material.color.set(color); s.material.opacity=0.9; s.visible=true;
        s.position.copy(p); s.scale.set(scale,scale,1);
        rings.push({ s, t:0, life:life||0.42, from:scale, to:scale*3.2 });
      }
      function killFX(p, color, big){
        ring(p, color, big?2.2:1.3, big?0.6:0.42);
        if(big) ring(p, "#ffffff", 1.0, 0.5);
        burst(p.x, p.y, p.z, color, big?14:9);
        burst(p.x, p.y+0.35, p.z, "#ffffff", big?9:5);
      }

      /* ---- stamp life-state on each spawned entity ---- */
      const _spawn = window.spawn;
      window.spawn = function(){
        _spawn();
        const a = active[active.length-1];
        if(a){ a._born = nowS(); a._ph = Math.random()*TAU; a._bs = a.sprite.scale.x; }
      };

      // (P4) ONE reusable scratch profile instead of a fresh object literal per enemy per
      // frame (~20/frame, >1200/sec). MEASURED, so the claim stays honest: this is worth
      // about 6% of a 0.4us/frame operation — V8's nursery allocation and escape analysis
      // already made the literal nearly free, so this is a tidiness win, NOT the GC fix it
      // looks like. Do not cite it as one. Reuse is safe because every field is
      // unconditionally reset on entry and the caller consumes the result before the next
      // call (see the read immediately below).
      const _prof={ amp:0.045, spd:3.2, breath:0.018, squash:0.025, baseY:0.9 };
      function profile(a){
        const ty=a.type, p=_prof;
        p.amp=0.045; p.spd=3.2; p.breath=0.018; p.squash=0.025; p.baseY=0.9;
        if(ty===TYPE.SCAMMER){
          p.amp=0.06; p.spd=4.2; p.squash=0.035;
          const m=a.sprite.material;
          if(typeof myScammerMats!=="undefined" && myScammerMats){
            if(m===myScammerMats[2]){ p.spd=3.2; p.squash=0.05; p.amp=0.05; }       // SNAKE slither
            else if(m===myScammerMats[1]){ p.amp=0.07; p.spd=2.6; p.squash=0.02; }  // RUGGER menace
            else if(m===myScammerMats[0]){ p.spd=5.4; p.amp=0.04; }                 // KOL hype jitter
          }
        } else if(ty===TYPE.HOLDER){ p.amp=0.07; p.spd=2.4; p.breath=0.03; }        // friendly bounce
        else if(ty===TYPE.HONEYPOT){ p.amp=0.05; p.spd=3.0; p.breath=0.04; }         // tempting pulse
        else if(ty===TYPE.DECOY){ p.amp=0.045; p.spd=2.0; p.squash=0.05; }           // floaty lure
        else if(ty===TYPE.RUGBOSS){ p.amp=0.10; p.spd=2.0; p.breath=0.02; p.squash=0.04; p.baseY=1.9; }
        return p;
      }

      const prevFrame = window.__frame;
      window.__frame = function(dt){
        if(prevFrame) prevFrame(dt);
        const t = nowS();

        // animate every live enemy: pop-in -> idle breathe + squash & stretch
        for(const a of active){
          const s=a.sprite; if(!s||!s.visible) continue;
          if(a._bs===undefined){ a._bs=s.scale.x; a._ph=Math.random()*TAU; a._born=t; }
          // RUG BOSS = a portrait truck sprite. The generic anim below assumes a SQUARE
          // sprite (drives both axes off scale.x), which would squish it — so the boss gets
          // its own aspect-preserving "alive" motion: monster-truck suspension bob + a fast
          // engine idle-judder, a gentle rock as it barrels down the lane, and a subtle
          // suspension squash & breathe. x (weave) and z (chase pin) are owned by the SET2
          // hook that ran earlier this frame; we only touch y, rotation and scale here.
          if(a.type===TYPE.RUGBOSS){
            const ph2=a._ph||0, bw=a._bw||s.scale.x, bh=a._bh||s.scale.x, by=(a._by!==undefined?a._by:1.9);
            s.position.y = by + Math.sin(t*3.0+ph2)*0.14 + Math.sin(t*15.0+ph2)*0.035;  // bob + engine judder
            s.material.rotation = Math.sin(t*2.1+ph2)*0.035;                             // drive-rock (~2°)
            const br=1+Math.sin(t*3.0+ph2)*0.02, sq=1+Math.sin(t*3.0+ph2+Math.PI*0.5)*0.03;
            s.scale.x = bw*br/Math.sqrt(sq); s.scale.y = bh*br*sq;                       // squash preserves aspect
            continue;
          }
          const pr=profile(a), ph=a._ph||0, age=t-(a._born||t);
          let pop=1;
          if(age<0.30){ const k=age/0.30, c=2.2; pop=1+(c+1)*Math.pow(k-1,3)+c*Math.pow(k-1,2); pop=Math.max(0.06,pop); }
          s.position.y = pr.baseY + Math.sin(t*pr.spd+ph)*pr.amp;
          const br = 1 + Math.sin(t*pr.spd+ph)*pr.breath;
          const sq = 1 + Math.sin(t*pr.spd+ph+Math.PI*0.5)*pr.squash;  // out of phase => squash & stretch
          s.scale.x = a._bs * pop * br / Math.sqrt(sq);
          s.scale.y = a._bs * pop * br * sq;
        }

        // advance shockwave rings
        for(let i=rings.length-1;i>=0;i--){
          const r=rings[i]; r.t+=dt; const k=Math.min(r.t/r.life,1);
          const e=1-Math.pow(1-k,3);                       // ease-out
          const sc=r.from+(r.to-r.from)*e;
          r.s.scale.set(sc,sc,1); r.s.material.opacity=(1-k)*0.9;
          if(k>=1){ r.s.visible=false; _ringFree.push(r.s); rings.splice(i,1); }   // (P3) recycle, don't dispose
        }
      };

      /* ---- color-coded kill / pickup feedback on every resolve ---- */
      const _resolve = window.resolve;
      window.resolve = function(e){
        const p=e.sprite.position.clone(), ty=e.type;
        _resolve(e);
        if(ty===TYPE.SCAMMER){ killFX(p,"#39ff7a",false); haptic("medium"); }
        else if(ty===TYPE.RUGBOSS){ killFX(p,GOLD,true); haptic("heavy"); }
        else if(ty===TYPE.BOMB){ killFX(p,GOLD,true); }
        else if(ty===TYPE.HOLDER||ty===TYPE.HONEYPOT||ty===TYPE.DECOY){ ring(p,RED,1.4,0.4); }
        else if(ty===TYPE.SHIELD){ ring(p,TEAL,1.2,0.42); }
        else if(ty===TYPE.PWR_SLOW){ ring(p,"#7df9ff",1.2,0.42); }
        else if(ty===TYPE.PWR_X2){ ring(p,GOLD,1.2,0.42); }
        else if(ty===TYPE.PWR_MAG){ ring(p,MAG,1.2,0.42); }
        else if(ty===TYPE.PWR_TRI){ ring(p,TRI_COL,1.3,0.44); }
        else if(ty===TYPE.PWR_ROCKET){ ring(p,ROCKET_COL,1.3,0.44); }
      };
      function haptic(kind){ try{ if(tg&&tg.HapticFeedback) tg.HapticFeedback.impactOccurred(kind); }catch(_){} }
    })();


  /* === ANCHOR: GAME_FEEL === */
    /* ===================================================================== *
     *  GAME-FEEL / JUICE BUNDLE                                              *
     *  hit-stop · rising-pitch combo audio · combo "heat" (bloom+vignette)   *
     *  · number-rolling score · speed lines · milestone flair · chomp pop    *
     * ===================================================================== */
    (function juiceBundle(){
      if (typeof THREE === "undefined") return;
      const clamp=(v,a,b)=>v<a?a:(v>b?b:v);

      /* ---------- DOM overlays (vignette heat + speed lines + style) ------- */
      const style=document.createElement("style");
      style.textContent=
        "#fxHeat{position:fixed;inset:0;pointer-events:none;z-index:9;opacity:0;"+
          "transition:opacity .25s ease;mix-blend-mode:screen}"+
        "#fxSpeed{position:fixed;inset:0;pointer-events:none;z-index:8;opacity:0;"+
          "background:repeating-linear-gradient(90deg,rgba(255,255,255,.0)0px,"+
          "rgba(255,255,255,.0)26px,rgba(255,255,255,.18)27px,rgba(255,255,255,.0)28px);"+
          "background-size:200% 100%;animation:fxSpeedScroll .5s linear infinite}"+
        "@keyframes fxSpeedScroll{from{background-position:0 0}to{background-position:-200% 0}}"+
        "#score{transition:transform .08s ease-out}"+
        "#score.pump{transform:scale(1.28)}";
      document.head.appendChild(style);
      const heat=document.createElement("div"); heat.id="fxHeat"; document.body.appendChild(heat);
      const speed=document.createElement("div"); speed.id="fxSpeed"; document.body.appendChild(speed);

      /* ---------- find the bloom pass to modulate -------------------------- */
      let bloomPass=null;
      try{ const c=window.__composer;
        if(c&&c.passes) bloomPass=c.passes.find(p=>p&&typeof p.strength==="number"); }catch(_){}
      const BLOOM_BASE = bloomPass?bloomPass.strength:0.95;
      const fogBase = scene.fog ? scene.fog.color.clone() : null;
      const fogHot  = new THREE.Color("#3a1030");

      /* ---------- rising-pitch combo chime (pentatonic climb) -------------- */
      const PENTA=[0,2,4,7,9,12,14,16,19,21,24];   // semitone offsets
      function comboChime(combo){
        if(!actx) return;
        try{
          const step=PENTA[Math.min(combo-1,PENTA.length-1)]||0;
          const f=440*Math.pow(2,step/12);
          const t=actx.currentTime;
          const o=actx.createOscillator(),g=actx.createGain();
          o.type="triangle"; o.frequency.setValueAtTime(f,t);
          o.frequency.exponentialRampToValueAtTime(f*1.5,t+0.05);
          g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(0.22,t+0.012);
          g.gain.exponentialRampToValueAtTime(0.0001,t+0.22);
          o.connect(g); g.connect(sfxGain||masterGain); o.start(t); o.stop(t+0.24);
          // sparkle harmonic
          const o2=actx.createOscillator(),g2=actx.createGain();
          o2.type="square"; o2.frequency.value=f*2;
          g2.gain.setValueAtTime(0.0001,t); g2.gain.exponentialRampToValueAtTime(0.06,t+0.01);
          g2.gain.exponentialRampToValueAtTime(0.0001,t+0.12);
          o2.connect(g2); g2.connect(sfxGain||masterGain); o2.start(t); o2.stop(t+0.14);
        }catch(_){}
      }
      function whoosh(){
        if(!actx) return;
        try{ const t=actx.currentTime, len=(actx.sampleRate*0.16)|0;
          const b=actx.createBuffer(1,len,actx.sampleRate), d=b.getChannelData(0);
          for(let i=0;i<len;i++) d[i]=(Math.random()*2-1)*(1-i/len);
          const s=actx.createBufferSource(); s.buffer=b;
          const f=actx.createBiquadFilter(); f.type="bandpass"; f.frequency.value=1200;
          const g=actx.createGain(); g.gain.setValueAtTime(0.18,t); g.gain.exponentialRampToValueAtTime(0.0001,t+0.16);
          s.connect(f); f.connect(g); g.connect(sfxGain||masterGain); s.start(t); s.stop(t+0.16);
        }catch(_){}
      }

      /* ---------- hit-stop state ------------------------------------------- */
      let freezeUntil=0;
      const FREEZE_TYPES={};
      [TYPE.SCAMMER,TYPE.HOLDER,TYPE.HONEYPOT,TYPE.DECOY,TYPE.RUGBOSS,TYPE.BOSS].forEach(t=>FREEZE_TYPES[t]=1);
      function hitstop(ms){ freezeUntil=Math.max(freezeUntil, nowS()+ms/1000); }

      /* ---------- score rolling -------------------------------------------- */
      let dispScore = (state.score||0);

      /* ---------- resolve wrapper: feedback per catch ---------------------- */
      const _resolve = window.resolve;
      window.resolve = function(e){
        const ty=e.type;
        _resolve(e);
        if(ty===TYPE.SCAMMER){
          comboChime(state.combo); whoosh();
          hitstop(45); shake(0.35);
          pop=1.36;                                  // sharper chomp
          // milestone flair
          if(state.combo>0 && state.combo%10===0){
            flashColor("rgba(255,210,63,.30)",0.5); shake(0.7); hitstop(70);
            try{ if(tg&&tg.HapticFeedback) tg.HapticFeedback.notificationOccurred("success"); }catch(_){}
          }
        } else if(ty===TYPE.RUGBOSS){
          whoosh(); flashColor("rgba(255,210,63,.40)",0.6); shake(0.9); hitstop(130); pop=1.5;
        } else if(ty===TYPE.BOMB){
          whoosh(); hitstop(90); pop=1.4;
        } else if(ty===TYPE.HOLDER||ty===TYPE.HONEYPOT||ty===TYPE.DECOY){
          flashColor("rgba(255,59,92,.30)",0.45); shake(0.5); hitstop(60);
        }
      };

      /* ---------- frame wrapper: heat / bloom / score / speed / freeze ----- */
      let heatVal=0;
      // (P4) last PAINTED states — see the quantization notes in the frame hook below.
      let _heatStep=-1, _spdStep=-1, _dispShown=null;
      // toLocaleString() re-resolves locale data on most engines; one cached formatter
      // instead, built once at load rather than 60 times a second.
      const _scoreFmt = (function(){ try{ return new Intl.NumberFormat(); }catch(_){ return null; } })();
      // renderScore() (index.html) writes the raw target number straight into #score on
      // every scoring event, which would desync the "already showing this number" guard
      // below. Invalidate it there so the roller always re-paints after a direct write.
      { const _rs = window.renderScore;
        if(typeof _rs==="function") window.renderScore=function(){ _rs.apply(this,arguments); _dispShown=null; }; }
      const prevFrame = window.__frame;
      window.__frame = function(dt){
        if(prevFrame) prevFrame(dt);
        const t=nowS();

        // hit-stop: cancel this frame's world scroll on enemies
        if(t<freezeUntil){
          const back=(state.running?state.speed:0)*dt;
          for(const a of active){ if(a&&!a.dead&&FREEZE_TYPES[a.type]) a.sprite.position.z-=back; }
        }

        // combo "heat" — smoothed, drives vignette + bloom + fog
        const target=clamp((state.combo||0)/18,0,1);
        heatVal += (target-heatVal)*0.08;
        /* (P4) #fxHeat is a FULL-VIEWPORT fixed layer with mix-blend-mode:screen. Assigning
         * .background every frame meant the browser re-parsed a radial-gradient, re-rastered
         * a whole-screen layer and re-blended it against the canvas 60 times a second — the
         * single most expensive main-thread item in the frame, spent redrawing a gradient
         * indistinguishable from the previous one (heatVal moves by <0.01/frame). Quantize
         * to 32 steps: the fade still reads as perfectly smooth, but the repaint fires a
         * couple of dozen times per run instead of ~3600 times per minute. bloom and fog
         * stay on the raw value — those are float uniforms, free to update.
         * Measured on desktop Chrome: the .background assignment alone costs 5.95us and the
         * guarded no-op 0.025us — and that is only the STYLE SET, it does not include the
         * full-screen raster + screen-blend it schedules, which is the part that hurts on
         * a phone. */
        const hstep=(heatVal*32)|0;
        if(hstep!==_heatStep){
          _heatStep=hstep;
          const q=hstep/32;
          heat.style.opacity=(q*0.55).toFixed(3);
          const hue=175-q*135;                     // 175(teal) .. 40(gold)
          heat.style.background=
            "radial-gradient(ellipse at center,rgba(0,0,0,0) 42%,"+
            "hsla("+hue+",100%,55%,"+(0.5*q).toFixed(3)+") 100%)";
        }
        if(bloomPass) bloomPass.strength = BLOOM_BASE + heatVal*0.95;
        if(scene.fog && fogBase) scene.fog.color.copy(fogBase).lerp(fogHot, heatVal*0.7);

        // speed lines — only while running and fast. (P4) same treatment: 20 steps, so the
        // opacity write (and the string it allocates) happens on change, not every frame.
        const sv = state.running ? clamp((state.speed-8)/16,0,1) : 0;
        const sstep=(sv*20)|0;
        if(sstep!==_spdStep){ _spdStep=sstep; speed.style.opacity=((sstep/20)*0.5).toFixed(3); }

        // number-rolling score
        if(typeof state.score==="number"){
          const d=state.score-dispScore;
          if(Math.abs(d)<0.5) dispScore=state.score; else dispScore+=d*0.2;
          if(el && el.score){
            // (P4) The rolled value only changes the DISPLAYED integer on a fraction of
            // frames, yet this formatted and wrote it on all of them. Format with the
            // cached Intl instance and skip the DOM entirely when the digits are identical.
            // Measured: Number#toLocaleString is 17.09us per call, the cached formatter
            // 0.615us — this one line was the most expensive JS in the frame.
            const n=Math.floor(dispScore);
            if(n!==_dispShown){ _dispShown=n; el.score.textContent=_scoreFmt?_scoreFmt.format(n):String(n); }
            if(d>4){ el.score.classList.add("pump"); clearTimeout(el.score._pt);
              el.score._pt=setTimeout(()=>el.score.classList.remove("pump"),90); }
          }
        }
      };

      // reset heat/score on new run
      ["startBtn","retryBtn"].forEach(id=>{ const b=$(id);
        if(b) b.addEventListener("click",()=>{ heatVal=0; dispScore=0; freezeUntil=0;
          _heatStep=-1; _spdStep=-1; _dispShown=null;   // force a repaint of the quantized overlays
          if(bloomPass) bloomPass.strength=BLOOM_BASE;
          if(scene.fog&&fogBase) scene.fog.color.copy(fogBase); }); });
    })();


    /* ===================================================================== *
     *  ENVIRONMENT OVERHAUL (v2)                                             *
     *  - remove all roadside objects (trees/pylons gone, empty lane)        *
     *  - skyline: 3D extruded crypto towers                                 *
     *  - reactive ad-SCREENS mounted on building faces                      *
     *  - slow parallax silhouette layers behind it all                      *
     *  Reuses existing pylons[]/skyline[] recycle loop (closure scope).     *
     * ===================================================================== */
    (function environmentOverhaulV2(){
      if (typeof THREE === "undefined") return;
      const rand=(a,b)=>a+Math.random()*(b-a);

      function halo(color,scale){
        let map=null; try{ map=radialGlow(color); }catch(_){}
        const s=new THREE.Sprite(new THREE.SpriteMaterial({ map, color:new THREE.Color(color),
          transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, fog:false, opacity:0.5 }));
        s.scale.set(scale,scale,1); return s;
      }
      function disposeObj(o){ try{ scene.remove(o);
        if(o.traverse) o.traverse(n=>{ n.geometry&&n.geometry.dispose&&n.geometry.dispose();
          n.material&&n.material.dispose&&n.material.dispose(); });
        else { o.geometry&&o.geometry.dispose&&o.geometry.dispose(); o.material&&o.material.dispose&&o.material.dispose(); }
      }catch(_){} }

      /* ---------- clear roadside entirely ---------- */
      try{ for(const o of pylons) disposeObj(o); }catch(_){}
      pylons.length=0;

      /* ---------- reactive ad-screen (canvas mounted on a tower) ---------- */
      const adScreens=[];
      // LEADERBOARD BILLBOARD — one 1:1 (square) screen shows the live global TOP 5 instead of
      // cycling ads. Data comes from the same Worker /top endpoint the game already uses.
      const LB_API=(window.__LB_API||"").replace(/\/+$/,"");
      let lbTop=null, lbDirty=false, lbClaimed=false;
      // Ad screens come in 3 aspect ratios, grouped so the admin can target each:
      //   wide 2:1 (small buildings) · square 1:1 (big) · tall 9:16 portrait (big).
      const SCREEN_KINDS = {
        wide:   { cw:256, ch:128 },   // 2:1
        square: { cw:208, ch:208 },   // 1:1
        tall:   { cw:144, ch:256 }    // 9:16 portrait
      };
      const AD_DEFAULTS = { m:["$XZILLA","WAGMI","PUMP IT","HODL","BUY THE DIP","DIAMOND HANDS","FEW","LFG","TO THE MOON"], c:[], img:[], l:[] };
      // Per-ratio ad pools (parallel arrays: message / color / imageUrl / clickLink).
      const AD_GROUPS = {
        wide:   { m:AD_DEFAULTS.m.slice(), c:[], img:[], l:[] },
        square: { m:[], c:[], img:[], l:[] },
        tall:   { m:[], c:[], img:[], l:[] }
      };
      // Effective pool for a screen kind: its own pool → else wide → else built-in defaults.
      function groupFor(kind){
        const g=AD_GROUPS[kind];
        if(g && g.m.length) return g;
        if(AD_GROUPS.wide.m.length) return AD_GROUPS.wide;
        return AD_DEFAULTS;
      }

      /* ---------- cached background-image system (from billboard-textures POC) ----------
       * One HTMLImageElement per URL, loaded once and shared by reference. drawAd()
       * draws the cached bitmap behind the text only once it has decoded (img._ready),
       * so there is zero per-frame image work — repaint happens only on message change. */
      const _adImgCache={};
      function adImage(url){
        if(!url) return null;
        if(_adImgCache[url]) return _adImgCache[url];
        const img=new Image(); img.crossOrigin="anonymous";
        img.onload=()=>{ img._ready=true; };
        img.onerror=()=>{ img._failed=true; };
        img.src=url;
        return (_adImgCache[url]=img);
      }

      /* ---------- decode window._adsPayload (Base64 ads-config.json) ----------
       * Returns the parsed array of {id,text,imageUrl,clickLink} or null on any
       * failure (missing/garbled payload), so the built-in AD_MSGS stay as fallback. */
      function decodeAdsPayload(){
        try{
          if(!window._adsPayload) return null;
          // utf-8-safe Base64 -> string -> JSON
          const bin=atob(window._adsPayload);
          let json; try{ json=decodeURIComponent(escape(bin)); }catch(_){ json=bin; }
          const data=JSON.parse(json);
          const arr=Array.isArray(data)?data:(data&&Array.isArray(data.ads)?data.ads:null);
          return (arr&&arr.length)?arr:null;
        }catch(e){ return null; }
      }
      (function applyAdsPayload(){
        const ads=decodeAdsPayload();
        if(!ads) return;   // keep built-in defaults
        const msgs=[],cols=[],imgs=[],links=[];
        for(const a of ads){
          const text=a&&typeof a.text==="string"?a.text.trim():"";
          const imageUrl=a&&typeof a.imageUrl==="string"?a.imageUrl:undefined;
          if(!text && !imageUrl) continue;   // need at least text OR an image (image-only allowed)
          msgs.push(text.toUpperCase().slice(0,60));   // "" for an image-only ad
          cols.push(/^#[0-9a-fA-F]{3,8}$/.test(a.color||"")?a.color:null);
          imgs.push(imageUrl);
          links.push(typeof a.clickLink==="string"?a.clickLink:undefined);
        }
        if(!msgs.length) return;
        AD_GROUPS.wide={ m:msgs, c:cols, img:imgs, l:links };   // built-in payload = the 2:1 (wide) pool
        imgs.forEach(adImage);   // warm the image cache so backgrounds are ready ASAP
      })();

      // The billboard panel itself is a FIXED size (flush-mounted on the tower
      // face) — it never grows. Longer text instead auto-shrinks its font
      // (28px down to 14px) and re-wraps until it fits, so the message
      // always stays fully on the screen no matter how long it is.
      // Draw an image to FILL W×H while preserving its aspect ratio (center-crop / "cover"),
      // so a 2:1 source borrowed onto a 9:16 panel fills the frame cleanly instead of squishing.
      function drawCover(x,img,W,H){
        const iw=img.naturalWidth||img.width, ih=img.naturalHeight||img.height;
        if(!iw||!ih){ x.drawImage(img,0,0,W,H); return; }
        const s=Math.max(W/iw,H/ih), dw=iw*s, dh=ih*s;
        x.drawImage(img,(W-dw)/2,(H-dh)/2,dw,dh);
      }
      function drawAd(scr,msg,color,imageUrl){
        const x=scr.ctx,W=scr.canvas.width,H=scr.canvas.height;
        const img=adImage(imageUrl);
        const text=String(msg==null?"":msg).trim();
        // IMAGE-ONLY: an ad with an image and no caption → full-bleed banner (no scrim, no text).
        if(!text && img && img._ready){
          x.fillStyle="#05030f"; x.fillRect(0,0,W,H);
          drawCover(x,img,W,H);
          x.strokeStyle=color||"#21e6ff"; x.lineWidth=6; x.strokeRect(5,5,W-10,H-10);
          x.shadowBlur=0; scr.tex.needsUpdate=true; return;
        }
        // Background: cached ad image if decoded, else the solid neon-dark panel.
        if(img&&img._ready){
          x.fillStyle="#05030f"; x.fillRect(0,0,W,H);          // base under transparent/letterboxed art
          x.globalAlpha=0.6; drawCover(x,img,W,H); x.globalAlpha=1;
          x.fillStyle="rgba(5,3,15,0.35)"; x.fillRect(0,0,W,H); // scrim so text stays legible
        } else {
          x.fillStyle="#05030f"; x.fillRect(0,0,W,H);
        }
        x.strokeStyle=color; x.lineWidth=6; x.strokeRect(5,5,W-10,H-10);
        x.fillStyle=color; x.shadowColor=color; x.shadowBlur=18;
        x.textAlign="center"; x.textBaseline="middle";
        const words=String(msg).split(" ");
        // Size the text off the LONG edge (not width) so a tall 9:16 panel gets big text too,
        // then shrink until every line fits BOTH across (widest line) and down (all lines).
        const L=Math.max(W,H);
        let fontPx=Math.max(14,Math.round(L/9)), lines=[], lh=32;
        const minPx=Math.max(10,Math.round(L/22));
        for(; fontPx>=minPx; fontPx-=2){
          x.font="bold "+fontPx+"px 'Press Start 2P',monospace";
          lines=[]; let line="";
          for(const w of words){
            const test=line?line+" "+w:w;
            if(x.measureText(test).width>W-24 && line){ lines.push(line); line=w; }
            else line=test;
          }
          lines.push(line);
          lh=Math.round(fontPx*1.15);
          let maxW=0; for(const ln of lines){ const lw=x.measureText(ln).width; if(lw>maxW) maxW=lw; }
          if(maxW<=W-16 && lines.length*lh<=H-16) break;   // fits across AND down -> use it
        }
        x.font="bold "+fontPx+"px 'Press Start 2P',monospace";
        const y0=H/2-(lines.length-1)*lh/2;
        lines.forEach((ln,i)=>x.fillText(ln,W/2,y0+i*lh));
        x.shadowBlur=0; scr.tex.needsUpdate=true;
      }
      // Short, rounded score for the tight billboard: WHOLE K (rounded), 1-decimal M.
      //   81,430 -> "81K"   ·   81,530 -> "82K"   ·   82,000 -> "82K"   ·   1.24M -> "1.2M"
      function abbrScore(n){
        n=Math.round(n)||0;
        if(n>=1e6) return (n/1e6).toFixed(1).replace(/\.0$/,"")+"M";
        if(n>=1e3) return (n/1e3).toFixed(0)+"K";
        return ""+n;
      }
      // Render the live global TOP 3 onto a square ad-screen canvas (same neon vocabulary as
      // drawAd). Only called on data change, so there's no per-frame canvas work.
      function drawLeaderboard(scr, list){
        const x=scr.ctx, W=scr.canvas.width, H=scr.canvas.height;
        // gold-tinted vignette background so it reads as "special", not another ad
        x.fillStyle="#0a0518"; x.fillRect(0,0,W,H);
        const bg=x.createRadialGradient(W/2,H*0.42,8,W/2,H/2,W*0.78);
        bg.addColorStop(0,"rgba(255,210,63,0.12)"); bg.addColorStop(1,"rgba(5,3,15,0)");
        x.fillStyle=bg; x.fillRect(0,0,W,H);
        // double gold frame
        x.strokeStyle=GOLD; x.lineWidth=6; x.strokeRect(5,5,W-10,H-10);
        x.strokeStyle="rgba(255,210,63,0.35)"; x.lineWidth=2; x.strokeRect(11,11,W-22,H-22);
        x.textBaseline="middle"; x.textAlign="center";
        // header + subtitle
        x.fillStyle=GOLD; x.shadowColor=GOLD; x.shadowBlur=14;
        x.font="bold "+Math.round(W/11)+"px 'Press Start 2P',monospace";
        x.fillText("TOP 3", W/2, 30); x.shadowBlur=0;
        x.fillStyle="#ffe9a8"; x.font="14px 'Orbitron',sans-serif";
        x.fillText("★ GLOBAL RANKS ★", W/2, 54);
        const rows=(list&&list.length)?list:null;
        if(!rows){
          x.fillStyle="#9fb6c9"; x.font="14px 'Orbitron',sans-serif";
          x.fillText(LB_API?"LOADING…":"—", W/2, H*0.66);
          scr.tex.needsUpdate=true; return;
        }
        const y0=76, rowH=(H-y0-14)/3, medal=["#ffd23f","#dfe7f0","#ff9a3a"];
        for(let i=0;i<3;i++){
          const cy=y0+rowH*i+rowH/2, col=medal[i], e=rows[i];
          // medal rank badge (circle)
          x.beginPath(); x.arc(24,cy,13,0,Math.PI*2); x.fillStyle=col;
          x.shadowColor=col; x.shadowBlur=10; x.fill(); x.shadowBlur=0;
          x.fillStyle="#0a0518"; x.textAlign="center"; x.font="bold 13px 'Orbitron',sans-serif";
          x.fillText(String(i+1), 24, cy+1);
          if(!e) continue;
          // Draw the (short) score FIRST, measure it, then fit the name in the leftover width so
          // the two can never overlap no matter how long the name or score is.
          const scoreStr=abbrScore(e.score||0);
          x.textAlign="right"; x.fillStyle=col; x.font="bold 15px 'Orbitron',sans-serif";
          x.fillText(scoreStr, W-12, cy);
          const nameX=42, avail=(W-12)-x.measureText(scoreStr).width-8-nameX;   // 8px gap before score
          x.textAlign="left"; x.fillStyle="#eaf2ff"; x.font="bold 15px 'Orbitron',sans-serif";
          let name=String(e.name||"—");
          if(x.measureText(name).width>avail){
            while(name.length>1 && x.measureText(name+"…").width>avail) name=name.slice(0,-1);
            name+="…";
          }
          x.fillText(name, nameX, cy);
        }
        scr.tex.needsUpdate=true;
      }
      function mountScreen(group, w, faceY, kind){
        kind = SCREEN_KINDS[kind] ? kind : "wide";
        const K = SCREEN_KINDS[kind];
        const c=document.createElement("canvas"); c.width=K.cw; c.height=K.ch;
        const scr={canvas:c,ctx:c.getContext("2d")}; scr.tex=new THREE.CanvasTexture(c);
        // plane width capped to the building face; height follows the canvas aspect ratio
        let sw;
        if(kind==="wide")        sw=Math.min(w*0.82,5.2);
        else if(kind==="square") sw=Math.min(w*0.80,4.6);
        else                     sw=Math.min(w*0.60,3.1);   // tall 9:16
        const sh=sw*(K.ch/K.cw);
        const m=new THREE.Mesh(new THREE.PlaneGeometry(sw,sh),
          new THREE.MeshBasicMaterial({map:scr.tex,transparent:true,depthWrite:false,fog:true}));
        m.position.set(0, faceY, 0);   // z offset applied by caller via group depth
        m._scr=scr; m._group=kind; m._t=Math.random()*4; m._mode="msg";
        // Dedicate the FIRST square (1:1) screen to the live TOP-5 leaderboard (if the board API
        // is configured); every other screen keeps cycling ads as before.
        if(kind==="square" && !lbClaimed && LB_API){ m._lb=true; m._mode="lb"; lbClaimed=true;
          m._baseSc=1.22; m.scale.set(1.22,1.22,1); }   // bigger than ad screens so it stands out
        const grp=groupFor(kind); m._msg=(Math.random()*grp.m.length)|0;
        if(m._lb) drawLeaderboard(scr, lbTop);
        else drawAd(scr, grp.m[m._msg], grp.c[m._msg]||CYAN, grp.img[m._msg]);
        group.add(m); adScreens.push(m);
        return m;
      }

      /* ---------- 3D crypto tower (optionally wears an ad-screen) ---------- */
      function towerTex(neon){
        const W=128,H=256,c=document.createElement("canvas");c.width=W;c.height=H;
        const x=c.getContext("2d");
        x.fillStyle="#080318"; x.fillRect(0,0,W,H);
        x.fillStyle=neon; x.globalAlpha=0.85;
        for(let wy=12; wy<H-10; wy+=18) for(let wx=10; wx<W-12; wx+=18)
          if(Math.random()>0.42) x.fillRect(wx,wy,8,11);
        x.globalAlpha=1; x.fillStyle=neon; x.fillRect(0,0,W,5);
        const t=new THREE.CanvasTexture(c); t.encoding=THREE.sRGBEncoding; return t;
      }
      function makeTower(neon, withAd){
        const g=new THREE.Group();
        const h=rand(11,26), w=rand(4,6.5), d=rand(4,6.5);
        const body=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),
          new THREE.MeshBasicMaterial({map:towerTex(neon),fog:true}));
        body.position.y=h/2-1.45; g.add(body);
        const antH=rand(1.5,3);
        const ant=new THREE.Mesh(new THREE.CylinderGeometry(0.05,0.05,antH,4),
          new THREE.MeshBasicMaterial({color:neon}));
        ant.position.y=h-1.45+antH/2; g.add(ant);
        const beacon=halo(GOLD,1.4); beacon.position.y=h-1.45+antH; g.add(beacon);
        if(withAd){
          // Small buildings → wide 2:1. Big buildings → square 1:1 or tall 9:16 (alternating).
          let kind, faceY;
          if(h < 17){ kind="wide"; faceY=h*0.62-1.45; }
          else { kind = (_bigAdN++ % 2) ? "tall" : "square"; faceY = (kind==="tall"? h*0.5 : h*0.55) - 1.45; }
          const scr=mountScreen(g, w, faceY, kind);
          scr.position.z = d/2 + 0.06;          // sit flush on the front face
        }
        return g;
      }
      let _bigAdN = 0;   // alternates square/tall across big buildings so both ratios appear

      /* ---------- rebuild skyline into skyline[] ---------- */
      try{ for(const o of skyline) disposeObj(o); }catch(_){}
      skyline.length=0;
      for(let side=-1; side<=1; side+=2){
        for(let i=0;i<SKY_PER;i++){
          const t=makeTower((i%2)?MAG:CYAN, (i%2===0));   // ~half wear a screen
          t.position.set(side*(15+Math.random()*6), 0, -34 + i*SKY_GAP);
          t.rotation.y = side<0 ? Math.PI*0.16 : -Math.PI*0.16;  // angle face toward player
          scene.add(t); skyline.push(t);
        }
      }

      /* ---------- ads.json override: lets you change billboard slogans without ----------
       * touching the game code. Host a JSON file at ADS_CONFIG_URL shaped like:
       *   { "messages": ["$XZILLA", "WAGMI", {"text":"TO THE MOON","color":"#ffd23f"}] }
       * Entries can be plain strings (use the default combo-tier color) or
       * {"text":"...","color":"#rrggbb"} to pin a specific color. A plain
       * array (no "messages" wrapper) also works. Falls back to AD_MSGS above if
       * the fetch fails, the file is missing, or it's malformed. ------------------ */
      // Live ads: the Worker /ads endpoint (KV-backed, updates are instant) is tried
      // first; GitHub-raw ads.json is the fallback if the Worker is unreachable/empty.
      const _adsApi      = (window.__LB_API||"").replace(/\/+$/,"");
      const ADS_WORKER   = _adsApi ? _adsApi+"/ads" : "";
      const ADS_FALLBACK = "https://raw.githubusercontent.com/Xzilla-memecoin/xzilla-game/main/ads.json";
      (function loadAdsConfig(){
        let lastSig = null;   // skip re-applying identical configs (no needless redraw/flicker)
        // Parse one ad list (array of strings / {text,color,imageUrl,clickLink}) into parallel arrays.
        function parseList(raw){
          const m=[],c=[],img=[],l=[];
          for(const item of (Array.isArray(raw)?raw:[])){
            const isObj = item && typeof item==="object";
            const text = typeof item==="string" ? item : (isObj && typeof item.text==="string" ? item.text : "");
            const imageUrl = (isObj && typeof item.imageUrl==="string") ? item.imageUrl : undefined;
            if((typeof text!=="string" || !text.trim()) && !imageUrl) continue;   // need text OR image (image-only allowed)
            m.push((text||"").trim().toUpperCase().slice(0,60));                  // "" for an image-only ad
            c.push((isObj && /^#[0-9a-fA-F]{3,8}$/.test(item.color||"")) ? item.color : null);
            img.push(imageUrl);
            l.push((isObj && typeof item.clickLink==="string") ? item.clickLink : undefined);
          }
          return { m, c, img, l };
        }
        function applyAds(data){
          // Accept grouped {wide,square,tall}, legacy {messages:[...]}, or a bare array.
          let groups;
          if(Array.isArray(data)) groups = { wide:data };
          else if(data && typeof data==="object"){
            if(Array.isArray(data.messages)) groups = { wide:data.messages };
            else if(Array.isArray(data.wide)||Array.isArray(data.square)||Array.isArray(data.tall))
              groups = { wide:data.wide, square:data.square, tall:data.tall };
            else return false;
          } else return false;
          const sig = JSON.stringify(groups);
          if(sig === lastSig) return true;   // unchanged → no-op
          const W=parseList(groups.wide), S=parseList(groups.square), T=parseList(groups.tall);
          if(!W.m.length && !S.m.length && !T.m.length) return false;
          lastSig = sig;
          AD_GROUPS.wide=W; AD_GROUPS.square=S; AD_GROUPS.tall=T;
          [W,S,T].forEach(g=>g.img.forEach(adImage));   // warm image caches
          for(const s of adScreens){ if(s._lb) continue;   // leave the leaderboard billboard alone
            const grp=groupFor(s._group); if(!grp.m.length) continue;
            s._msg=s._msg%grp.m.length; s._t=0;
            drawAd(s._scr, grp.m[s._msg], grp.c[s._msg]||CYAN, grp.img[s._msg]); }
          return true;
        }
        const tryUrl = u => u ? fetch(u,{cache:"no-store"}).then(r=>r.ok?r.json():null) : Promise.resolve(null);
        function loadOnce(){
          return tryUrl(ADS_WORKER)
            .then(d=>{ if(applyAds(d)) return; return tryUrl(ADS_FALLBACK).then(applyAds); })   // worker → github → built-in defaults
            .catch(()=>{ /* keep built-in defaults */ });
        }
        loadOnce();
        // LIVE REFRESH: re-poll the Worker so newly published ads appear WITHOUT a reload.
        // Only while the tab is visible (saves requests on backgrounded tabs); also refresh
        // immediately when the player returns to the tab. applyAds() de-dupes unchanged data.
        const pollAds = ()=>{ if(!document.hidden) tryUrl(ADS_WORKER).then(d=>{ if(d) applyAds(d); }).catch(()=>{}); };
        setInterval(pollAds, 60000);
        document.addEventListener("visibilitychange", ()=>{ if(!document.hidden) pollAds(); });

        // LEADERBOARD BILLBOARD — poll the global TOP 5 and flag a redraw when it changes.
        function fetchLbTop(){
          if(!LB_API) return;
          fetch(LB_API+"/top?t="+Date.now(),{cache:"no-store"}).then(r=>r.ok?r.json():null).then(d=>{
            if(d && Array.isArray(d.top)){ lbTop=d.top.slice(0,3); lbDirty=true; }
          }).catch(()=>{});
        }
        if(LB_API){
          fetchLbTop();
          setInterval(()=>{ if(!document.hidden) fetchLbTop(); }, 60000);
          document.addEventListener("visibilitychange", ()=>{ if(!document.hidden) fetchLbTop(); });
        }
      })();

      /* ---------- slow parallax silhouette layers ---------- */
      const farLayers=[];
      function silhouetteTex(){
        const W=512,H=160,c=document.createElement("canvas");c.width=W;c.height=H;
        const x=c.getContext("2d"); x.clearRect(0,0,W,H); let bx=0;
        while(bx<W){ const bw=18+Math.random()*42, bh=40+Math.random()*100;
          const col=Math.random()>0.5?"#ff2bd6":"#21e6ff";
          x.fillStyle="#0a0420"; x.fillRect(bx,H-bh,bw,bh);
          x.strokeStyle=col; x.lineWidth=2; x.strokeRect(bx,H-bh,bw,bh);
          x.fillStyle=col;
          for(let wy=H-bh+8;wy<H-6;wy+=12) for(let wx=bx+5;wx<bx+bw-6;wx+=10)
            if(Math.random()>0.5) x.fillRect(wx,wy,4,6);
          bx+=bw+6; }
        const t=new THREE.CanvasTexture(c); t.wrapS=THREE.RepeatWrapping; t.repeat.x=2.2;
        t.encoding=THREE.sRGBEncoding; return t;
      }
      for(let k=0;k<2;k++){
        const m=new THREE.Mesh(new THREE.PlaneGeometry(130,15+k*7),
          new THREE.MeshBasicMaterial({ map:silhouetteTex(), transparent:true,
            depthWrite:false, fog:true, opacity:0.8-k*0.28 }));
        m.position.set(0, 5.5+k*3, -50-k*7);
        m._par=0.4-k*0.16; scene.add(m); farLayers.push(m);
      }

      /* ---------- per-frame: parallax + reactive ad-screens ---------- */
      const prevFrame=window.__frame;
      window.__frame=function(dt){
        if(prevFrame) prevFrame(dt);
        const t=nowS(), sp=(state.running?state.speed:3.5);
        for(const f of farLayers){ const tex=f.material.map;
          if(tex) tex.offset.x=(tex.offset.x + sp*f._par*dt*0.03)%1; }
        let boss=false;
        for(const a of active){ if(a&&!a.dead&&(a.type===TYPE.RUGBOSS||a.type===TYPE.BOSS)){ boss=true; break; } }
        const combo=state.combo||0;
        const warn = boss || !!window.__rugWarn;   // flash during the 3s pre-warning AND the fight
        for(const s of adScreens){ s._t+=dt;
          if(s._lb){   // leaderboard billboard — always shows the live TOP 3 (never the ad cycle/boss flash)
            s.material.opacity=1;
            const base=s._baseSc||1, p=base*(1+Math.sin(t*2.2)*0.045);   // gentle breathing pulse draws the eye
            s.scale.set(p,p,1);
            if(lbDirty || s._mode!=="lb"){ s._mode="lb"; drawLeaderboard(s._scr, lbTop); lbDirty=false; }
            continue;
          }
          if(warn){
            if(s._mode!=="boss"){ s._mode="boss"; drawAd(s._scr,"RUG INCOMING",RED); }
            s.material.opacity=0.6+0.4*Math.sin(t*12);
          } else {
            s.material.opacity=1;
            if(s._mode==="boss"){ s._mode="msg"; s._t=99; }
            if(s._t>3.4){ s._t=0; const grp=groupFor(s._group); s._msg=(s._msg+1)%grp.m.length;
              const tierCol=combo>=10?GOLD:(combo>=5?MAG:CYAN);
              drawAd(s._scr, grp.m[s._msg], grp.c[s._msg]||tierCol, grp.img[s._msg]); }
          }
        }
      };
    })();


    /* ===================================================================== *
     *  iOS / TELEGRAM TAP RELIABILITY FIX                                    *
     *  - Telegram iOS steals taps via its swipe-to-close gesture unless      *
     *    disableVerticalSwipes() is called (ready/expand alone isn't enough) *
     *  - touch-action:manipulation kills the iOS ~300ms tap delay            *
     * ===================================================================== */
    (function iosTapFix(){
      const s=document.createElement("style");
      s.textContent=
        "button,.tab,.btn,.sbtn,.sbuy,#soundBtn,#connectBtn,"+
        "[data-tab],[data-upg],[data-skin]{touch-action:manipulation!important;"+
        "cursor:pointer;-webkit-tap-highlight-color:transparent;}";
      document.head.appendChild(s);
      function assert(){ try{ if(typeof tg!=="undefined" && tg){
        tg.ready&&tg.ready(); tg.expand&&tg.expand();
        tg.disableVerticalSwipes&&tg.disableVerticalSwipes();
        // expand() can change the viewport without Telegram reliably firing
        // viewportChanged (esp. if already expanded) — force a re-measure so
        // #game always re-syncs to the settled Telegram viewport height.
        window.dispatchEvent(new Event("resize")); } }catch(_){} }
      assert();
      // Telegram can finish expanding a beat late on iOS — re-assert a couple
      // of times to catch the settled viewportStableHeight.
      setTimeout(assert, 400);
      setTimeout(assert, 1200);
    })();

    /* ===================================================================== *
     *  TELEGRAM FULLSCREEN + SAFE AREA                                        *
     *  Telegram's webview often reports CSS env(safe-area-inset-*) as 0 and    *
     *  draws its own header/controls over the top, so the top menu (tabbar/    *
     *  HUD) got hidden until game over. Go fullscreen (Bot API 8.0+) and       *
     *  offset the top/bottom UI using Telegram's JS safe-area insets instead.  *
     * ===================================================================== */
    (function tgSafeArea(){
      if(typeof tg==="undefined" || !tg) return;   // only inside Telegram (browser keeps the env() CSS)
      // Fullscreen removes Telegram's top header bar for maximum game area. The small ✕/⋯
      // controls Telegram forces in the corner can't be hidden (platform requirement) — the
      // safe-area insets below keep our UI clear of them.
      try{ if(tg.requestFullscreen && !tg.isFullscreen) tg.requestFullscreen(); }catch(_){}
      const root=document.documentElement;
      function apply(){
        let top=0, bot=0;
        try{ const s=tg.safeAreaInset;        if(s){ top+=s.top||0; bot+=s.bottom||0; } }catch(_){}   // device notch
        try{ const c=tg.contentSafeAreaInset; if(c){ top+=c.top||0; bot+=c.bottom||0; } }catch(_){}   // Telegram header/controls
        root.style.setProperty("--tg-top", top+"px");
        root.style.setProperty("--tg-bottom", bot+"px");
        window.dispatchEvent(new Event("resize"));
      }
      apply();
      ["safeAreaChanged","contentSafeAreaChanged","fullscreenChanged","viewportChanged"].forEach(ev=>{
        try{ tg.onEvent && tg.onEvent(ev, apply); }catch(_){}
      });
      setTimeout(apply, 400); setTimeout(apply, 1200);
      const st=document.createElement("style");
      st.textContent=
        "#tabbar{ padding-top:calc(8px + var(--tg-top,0px)) !important; }"+
        "#hud{ padding-top:calc(8px + var(--tg-top,0px)) !important; }"+
        "#pauseBtn{ top:calc(10px + var(--tg-top,0px)) !important; }"+
        "#startScreen{ padding-top:calc(64px + var(--tg-top,0px)) !important; }"+
        "#gameOverScreen{ padding-top:calc(12px + var(--tg-top,0px)) !important; }"+
        ".panel{ padding-top:calc(64px + var(--tg-top,0px)) !important; }"+
        "#soundBtn{ bottom:calc(14px + var(--tg-bottom,0px)) !important; }"+
        "#tiltBtn{ bottom:calc(68px + var(--tg-bottom,0px)) !important; }";
      document.head.appendChild(st);
    })();

    /* refresh HUD lives to reflect upgraded max HP on boot ------------------- */
    renderLives();
  })();

/* ============================================================================
   RUG-BOSS DANGER GRID — a red neon grid on the ground that appears ONLY while a
   RUG BOSS is on the field and scrolls toward the player, exactly like the classic
   synthwave grid ("red lights run on the ground, same as the green"). Standalone &
   last so it wraps window.__frame after every other hook; fades in/out smoothly and
   is hidden on menus/pause/game-over. Uses globals scene/CAM/active/TYPE/state. ==*/
(function bossDangerGrid(){
  if(typeof THREE==="undefined" || typeof scene==="undefined" || typeof active==="undefined") return;
  const RED = 0xff2b3c;
  const BASE_Z = -6, CELL = 180/90;            // 90 divisions over 180 => 2-unit cell = seamless wrap step
  const grid = new THREE.GridHelper(180, 90, RED, RED);
  grid.position.set(0, -1.43, BASE_Z);         // just above the grass floor (-1.45), below the sprites (0.9)
  grid.material.transparent = true; grid.material.opacity = 0; grid.material.depthWrite = false;
  grid.visible = false;
  scene.add(grid);

  const bossOnField = () => {
    const rb = (typeof TYPE!=="undefined" && TYPE.RUGBOSS!=null) ? TYPE.RUGBOSS : 7;
    for(const a of active){ if(a && !a.dead && a.type===rb) return true; }
    return false;
  };

  let op = 0;                                  // current (eased) opacity
  const prev = window.__frame;
  window.__frame = function(dt){
    if(prev) prev(dt);
    // pre-warn: fade the grid in 2s BEFORE the boss lands (window.__rugBossAt = its arrival time),
    // then hold it while the boss is on the field.
    const preWarn = !!(window.__rugBossAt && performance.now()*0.001 >= window.__rugBossAt - 2);
    const on = !!(state && state.running && (preWarn || bossOnField()));
    op += ((on ? 0.6 : 0) - op) * Math.min(1, dt*6);   // smooth ~0.4s fade in/out
    if(op < 0.01 && !on){ if(grid.visible) grid.visible = false; return; }
    grid.visible = true; grid.material.opacity = op;
    // scroll toward the player and wrap one cell at a time so the lines stream seamlessly
    const sp = (state.running ? state.speed : 3.5) * dt;
    grid.position.z += sp;
    if(grid.position.z > BASE_Z + CELL) grid.position.z -= CELL;
  };
})();

/* ============================================================================
   SHIELD BUBBLE — a visible teal aura around Xrider whenever a shield is armed
   (HEAD START, a picked-up SHIELD, or the one handed back by SECOND WIND). The
   shield always WORKED — including eating a boss ram — but there was no visual,
   so players couldn't tell they had one or that a hit consumed it. This draws an
   additive glow sprite that tracks the player and fades in/out with `shieldActive`.
   Standalone & last so it wraps __frame after everything else. ==================*/
(function shieldBubble(){
  if(typeof THREE==="undefined" || typeof scene==="undefined" || typeof player==="undefined") return;
  const S=128, cv=document.createElement("canvas"); cv.width=cv.height=S; const x=cv.getContext("2d");
  // Draw the bubble in WHITE (luminance only); the sprite's material.color applies the
  // equipped skin's tint, so the shield glows in whatever colour Xrider is wearing.
  const g=x.createRadialGradient(S/2,S/2,S*0.30,S/2,S/2,S*0.5);   // hollow centre, bright rim => bubble
  g.addColorStop(0.00,"rgba(255,255,255,0)");
  g.addColorStop(0.72,"rgba(255,255,255,0.03)");
  g.addColorStop(0.89,"rgba(255,255,255,0.12)");   // very faint outer rim — barely-there ghost edge
  g.addColorStop(1.00,"rgba(255,255,255,0)");
  x.fillStyle=g; x.beginPath(); x.arc(S/2,S/2,S/2,0,Math.PI*2); x.fill();
  const tex=new THREE.CanvasTexture(cv);
  const mat=new THREE.SpriteMaterial({map:tex,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,opacity:0});
  const bub=new THREE.Sprite(mat); bub.scale.set(4.6,4.6,1); bub.visible=false; scene.add(bub);
  let op=0, curTint="";
  // Pull the equipped skin's colour (OG-green default has a null tint → fall back to neon green).
  const skinTint=()=>{ try{ const s=SKINS.find(k=>k.id===econ.skin); if(s&&s.tint) return s.tint; }catch(_){} return "#39ff7a"; };
  const prev=window.__frame;
  window.__frame=function(dt){
    if(prev) prev(dt);
    const want=!!(typeof shieldActive!=="undefined" && shieldActive && state && state.running);
    op += ((want?1:0)-op) * Math.min(1, dt*12);        // snappy ~0.15s fade so a consumed shield visibly pops off
    if(op<0.02 && !want){ if(bub.visible) bub.visible=false; return; }
    const tint=skinTint(); if(tint!==curTint){ curTint=tint; try{ mat.color.set(tint); }catch(_){} }
    bub.visible=true;
    bub.position.set(player.position.x, player.position.y, player.position.z+0.05);
    const pulse=1+Math.sin(performance.now()*0.006)*0.05; // gentle breathing so it reads as an active field
    bub.scale.set(4.6*pulse, 4.6*pulse, 1);
    mat.opacity=op*0.4;   // very subtle — a faint protective haze
  };
})();

  // (Removed the rear-tire overlay: a vertical squash on a billboarded sprite read as
  //  jittering feet, not rotation. A real spinning illusion needs an animated tire
  //  sprite-sheet or a small procedural spinner — to revisit later.)

  /* === ANCHOR: GROWTH === */
  /* ========================================================================== *
   *  GROWTH LAYER                                                               *
   *  Three features whose job is to push the game OUTWARD instead of deeper:    *
   *    1. SHARE CARD  — every run renders a PNG you can post. The game's only   *
   *                     previous output was a text string, which nobody posts.  *
   *    2. DAILY RUG RUN — one shared seed, one attempt, one board per UTC day.  *
   *                     Scarcity + a common reference point is what makes a     *
   *                     score worth comparing (and therefore worth posting).    *
   *    3. PUMP MODE  — the live $XZILLA chart drives a global score modifier,   *
   *                     so the token and the game reinforce each other drun.   *
   *  Defined last so it wraps every earlier override.                           *
   * ========================================================================== */
  (function(){
    if (typeof THREE === "undefined") return;

    /* ---------------------------------------------------------------- utils */
    function utcDay(ts){
      const d = new Date(typeof ts==="number" ? ts : Date.now());
      return d.getUTCFullYear()+"-"+String(d.getUTCMonth()+1).padStart(2,"0")+"-"+String(d.getUTCDate()).padStart(2,"0");
    }
    // ms until the next 00:00 UTC — drives the "next run in" countdown.
    function msToNextUtcDay(){
      const n=new Date();
      return Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()+1) - n.getTime();
    }
    function hms(ms){
      const s=Math.max(0,Math.floor(ms/1000));
      return String(Math.floor(s/3600)).padStart(2,"0")+":"+String(Math.floor(s/60)%60).padStart(2,"0")+":"+String(s%60).padStart(2,"0");
    }

    /* ====================================================================== *
     *  1. SHARE CARD                                                          *
     *  Renders the run to a 1200×675 PNG (16:9 — the ratio X shows uncropped) *
     *  and hands it to the native share sheet, falling back to a download.    *
     *  Everything is drawn procedurally: pulling the hero art onto the canvas *
     *  would taint it cross-origin and make toBlob() throw, so the card uses  *
     *  type + an emoji glyph instead of the bitmap logo.                      *
     * ====================================================================== */
    const CARD_W=1200, CARD_H=675;

    function roundRect(x,rx,ry,w,h,r){
      x.beginPath();
      x.moveTo(rx+r,ry); x.arcTo(rx+w,ry,rx+w,ry+h,r); x.arcTo(rx+w,ry+h,rx,ry+h,r);
      x.arcTo(rx,ry+h,rx,ry,r); x.arcTo(rx,ry,rx+w,ry,r); x.closePath();
    }

    function drawCard(data){
      const c=document.createElement("canvas"); c.width=CARD_W; c.height=CARD_H;
      const x=c.getContext("2d");

      // BACKDROP — the player's actual last frame when we have one (captured in index.html
      // the instant death was rendered), otherwise the procedural city below. A real
      // snapshot is the whole point of the card: it shows the run that happened, with the
      // scam that got them still on screen.
      const shot = data.shot;
      if(shot){
        x.drawImage(shot, 0, 0, CARD_W, CARD_H);   // already cover-fit to 16:9 at capture
        // Darken it. The frame is busy neon and the score/rank sit on top of it — without
        // this the number is unreadable at timeline thumbnail size, which is the only size
        // most people will ever see. Heavier at the edges, lighter through the middle so
        // the bike and the city still read.
        const v=x.createLinearGradient(0,0,0,CARD_H);
        v.addColorStop(0,"rgba(6,2,20,0.80)"); v.addColorStop(0.42,"rgba(6,2,20,0.34)");
        v.addColorStop(1,"rgba(6,2,20,0.86)");
        x.fillStyle=v; x.fillRect(0,0,CARD_W,CARD_H);
      } else {
        // backdrop: deep violet vertical fade + a perspective neon grid, mirroring the game
        const bg=x.createLinearGradient(0,0,0,CARD_H);
        bg.addColorStop(0,"#0a0326"); bg.addColorStop(0.55,"#12073d"); bg.addColorStop(1,"#07021a");
        x.fillStyle=bg; x.fillRect(0,0,CARD_W,CARD_H);

        const hz=CARD_H*0.70;                     // horizon line the grid converges to
        const glow=x.createRadialGradient(CARD_W/2,hz,20, CARD_W/2,hz,CARD_W*0.65);
        glow.addColorStop(0,"rgba(255,43,214,0.30)"); glow.addColorStop(1,"rgba(255,43,214,0)");
        x.fillStyle=glow; x.fillRect(0,0,CARD_W,CARD_H);

        x.save(); x.beginPath(); x.rect(0,hz,CARD_W,CARD_H-hz); x.clip();
        x.strokeStyle="rgba(33,230,255,0.34)"; x.lineWidth=2;
        for(let i=-14;i<=14;i++){                 // verticals fanning out from the vanishing point
          x.beginPath(); x.moveTo(CARD_W/2, hz); x.lineTo(CARD_W/2 + i*180, CARD_H); x.stroke();
        }
        for(let i=1;i<=9;i++){                    // horizontals, spaced non-linearly for depth
          const t=i/9, y=hz + Math.pow(t,2.1)*(CARD_H-hz);
          x.beginPath(); x.moveTo(0,y); x.lineTo(CARD_W,y); x.stroke();
        }
        x.restore();
      }

      // Scrim behind the centre block. Without it the grid lines run straight through the
      // score and rank text, which is exactly the region that has to stay readable when
      // the image is thumbnailed in a timeline.
      // Lighter over a photo: the snapshot backdrop already carries its own darkening pass,
      // and stacking both flattens the frame into mud — which throws away the reason for
      // using a real screenshot in the first place.
      const sa = shot ? 0.34 : 0.62;
      const scrim=x.createLinearGradient(0,140,0,600);
      scrim.addColorStop(0,"rgba(6,2,20,0)");
      scrim.addColorStop(0.22,"rgba(6,2,20,"+sa+")");
      scrim.addColorStop(0.80,"rgba(6,2,20,"+sa+")");
      scrim.addColorStop(1,"rgba(6,2,20,0)");
      x.fillStyle=scrim; x.fillRect(0,140,CARD_W,460);

      // ---- header ---------------------------------------------------------
      x.textBaseline="alphabetic";
      x.font="700 30px Impact, 'Arial Black', sans-serif";
      x.fillStyle="#39ff7a"; x.fillText("🦖 XZILLA", 56, 74);
      x.fillStyle="#21e6ff"; x.fillText("RUG SMASHER", 56+x.measureText("🦖 XZILLA ").width, 74);

      // mode chip, top-right — DAILY / PUMP / BLOOD get their own colour
      if(data.chip){
        x.font="700 22px 'Arial Black', sans-serif";
        const cw=x.measureText(data.chip).width+38;
        x.fillStyle="rgba(0,0,0,0.42)"; roundRect(x, CARD_W-56-cw, 46, cw, 42, 21); x.fill();
        x.strokeStyle=data.chipColor; x.lineWidth=2.5; x.stroke();
        x.fillStyle=data.chipColor; x.textAlign="center";
        x.fillText(data.chip, CARD_W-56-cw/2, 75); x.textAlign="left";
      }

      // ---- the number (the whole reason the card exists) ------------------
      x.textAlign="center";
      x.font="600 26px 'Trebuchet MS', sans-serif"; x.fillStyle="rgba(255,255,255,0.62)";
      x.fillText(data.scoreLabel || "SCORE", CARD_W/2, 196);

      // Auto-shrink to fit: a 7-figure score at the base size runs off both edges.
      let scoreSize=168;
      do{ x.font="700 "+scoreSize+"px Impact, 'Arial Black', sans-serif"; scoreSize-=6; }
      while(x.measureText(data.score).width > CARD_W-140 && scoreSize > 70);
      x.shadowColor="rgba(255,210,63,0.85)"; x.shadowBlur=44;
      x.fillStyle="#ffd23f"; x.fillText(data.score, CARD_W/2, 336);
      x.shadowBlur=0;

      // rank title
      x.font="700 46px Impact, 'Arial Black', sans-serif";
      x.shadowColor="rgba(255,43,214,0.7)"; x.shadowBlur=26;
      x.fillStyle="#ff2bd6"; x.fillText(data.title, CARD_W/2, 400);
      x.shadowBlur=0;

      // player handle
      if(data.name){
        x.font="600 27px 'Trebuchet MS', sans-serif"; x.fillStyle="rgba(255,255,255,0.80)";
        x.fillText(data.name, CARD_W/2, 442);
      }

      // ---- stat strip ------------------------------------------------------
      const stats=data.stats.slice(0,4);
      const boxW=232, gap=18, totalW=stats.length*boxW+(stats.length-1)*gap;
      let sx=(CARD_W-totalW)/2;
      stats.forEach(s=>{
        x.fillStyle="rgba(8,3,26,0.72)"; roundRect(x, sx, 476, boxW, 92, 14); x.fill();
        x.strokeStyle="rgba(33,230,255,0.45)"; x.lineWidth=2; x.stroke();
        x.textAlign="center";
        x.font="600 18px 'Trebuchet MS', sans-serif"; x.fillStyle="rgba(255,255,255,0.55)";
        x.fillText(s.k, sx+boxW/2, 508);
        x.font="700 36px 'Arial Black', sans-serif"; x.fillStyle=s.c||"#39ff7a";
        x.fillText(s.v, sx+boxW/2, 550);
        sx+=boxW+gap;
      });

      // ---- footer ----------------------------------------------------------
      x.textAlign="left";
      x.font="600 24px 'Trebuchet MS', sans-serif"; x.fillStyle="rgba(255,255,255,0.55)";
      x.fillText("xzilla.io", 56, 626);
      x.textAlign="right";
      x.fillStyle="#39ff7a"; x.font="700 24px 'Arial Black', sans-serif";
      x.fillText("$XZILLA", CARD_W-56, 626);
      x.textAlign="left";
      return c;
    }

    // Assemble the card payload for the run that just ended.
    function cardData(){
      const sc     = Math.round(state.score||0);
      const best   = Math.max(Math.round(state.best||0), (myBest&&myBest.score)||0, sc);
      const t      = titleForScore(sc) || titleForScore(best);
      const tier   = window.__holderVerified ? tierFor(econ.holdings) : null;
      const d      = {
        score: fmt(sc),
        title: t ? t.name : "ROOKIE",
        name:  (typeof tgName==="function" ? tgName() : ""),
        // The frame the player died on, captured in index.html. Null on the very first
        // card of a session (nobody has died yet) or if the read failed — drawCard() then
        // falls back to the procedural city, so a missing shot is never a broken card.
        shot:  window.__deathShot || null,
        stats: [
          {k:"SCAMS SMASHED", v:fmt(run.kills), c:"#39ff7a"},
          {k:"BEST COMBO",    v:"×"+fmt(run.combo||0), c:"#21e6ff"},
          {k:"RUG BOSSES",    v:fmt(run.boss||0), c:"#ff2bd6"},
        ],
      };
      if(drun.active){
        d.chip="DAILY RUG RUN"; d.chipColor="#21e6ff"; d.scoreLabel="TODAY'S SCORE";
        if(drun.rank) d.stats.push({k:"WORLD RANK", v:"#"+drun.rank, c:"#ffd23f"});
      } else if(pump.mult>1){
        d.chip=pump.label||"PUMP MODE"; d.chipColor="#ff2bd6";
      } else if(tier && tier.m>1){
        d.chip="◆ "+tier.l+" "+tier.m+"×"; d.chipColor=tier.c;
      }
      if(d.stats.length<4 && tier && tier.m>1) d.stats.push({k:"HOLDER TIER", v:tier.l, c:tier.c});
      return d;
    }

    function shareText(){
      const sc=Math.round(state.score||0);
      const t=titleForScore(sc); const title=t?t.name:"ROOKIE";
      if(drun.active){
        return "🦖 XZILLA DAILY RUG RUN — "+drun.day+"\n"+fmt(sc)+" pts"+(drun.rank?(" · world #"+drun.rank):"")+
               "\nSame seed, same scams, one shot each. Beat me 👇";
      }
      return "🦖 I smashed "+fmt(sc)+" pts as "+title+" in XZILLA: RUG SMASHER!\nThink you can beat my rank? 👇";
    }

    // A "snapshot" freezes both the drawing and the caption at the moment it's taken, so
    // the image the player previews is byte-identical to the one they share — the live run
    // state it was derived from may already have been reset by then.
    function snapshot(){ return { data:cardData(), text:shareText(), day:drun.active?drun.day:null }; }

    // Download the PNG and put the caption on the clipboard. Shared by the share-sheet
    // fallback and by the explicit SAVE PNG button, so both behave identically.
    async function saveCardBlob(blob, s, text){
      const url=URL.createObjectURL(blob);
      const a=document.createElement("a");
      a.href=url; a.download="xzilla-"+(s.day?("daily-"+s.day):"score")+".png";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(()=>URL.revokeObjectURL(url), 10000);
      try{ await navigator.clipboard.writeText(text); toast("Card saved · caption copied — post it! 📣", CYAN); }
      catch(_){ toast("Score card saved to your downloads 📸", CYAN); }
    }
    async function saveCard(snap){
      const s=snap || snapshot();
      const link=refLink();
      try{
        const canvas=drawCard(s.data);
        const blob=await new Promise(res=>canvas.toBlob(res,"image/png"));
        if(!blob) throw new Error("no blob");
        await saveCardBlob(blob, s, s.text+(link?("\n"+link):""));
      }catch(e){ toast("Couldn't build the card", RED); }
    }

    let _sharingCard=false;
    async function shareCard(snap){
      if(_sharingCard) return;
      _sharingCard=true;
      try{
        const s=snap || snapshot();
        const canvas=drawCard(s.data);
        const blob=await new Promise(res=>canvas.toBlob(res,"image/png"));
        if(!blob) throw new Error("no blob");
        const file=new File([blob],"xzilla-score.png",{type:"image/png"});
        const link=refLink();
        const text=s.text+(link?("\n"+link):"");

        // Preferred path: the OS share sheet WITH the image attached. canShare({files})
        // must be checked first — Safari/Chrome throw on share() with unsupported files.
        if(navigator.canShare && navigator.canShare({files:[file]}) && navigator.share){
          try{ await navigator.share({files:[file], text}); return; }
          catch(err){ if(err && err.name==="AbortError") return; /* else fall through */ }
        }
        // Fallback: save the PNG and put the caption on the clipboard, so posting it
        // is still two taps rather than impossible.
        await saveCardBlob(blob, s, text);
      }catch(e){
        toast("Couldn't build the card — sharing text instead", GOLD);
        try{ shareScore(); }catch(_){}
      }finally{ _sharingCard=false; }
    }
    window.__shareCard = shareCard;

    /* ---- POST ON X -------------------------------------------------------
     * X's tweet intent takes TEXT ONLY — a link can never attach an image, and
     * posting media needs the API with the user's OAuth token. So the easiest
     * honest route is: copy the PNG to the clipboard, open the composer with the
     * caption already written, and let them paste. Two keystrokes instead of
     * download → find the file → attach.
     *
     * Two ordering rules make this actually work:
     *   - ClipboardItem is handed a PROMISE for the blob, so the write begins
     *     inside the click gesture rather than after an await (Safari rejects a
     *     write that starts later, and Chrome requires the document to be focused).
     *   - the composer is opened AFTER the copy resolves, because the new tab
     *     takes focus and would abort a still-pending clipboard write.
     * If the popup is blocked we hand back a real button instead of dead-ending. */
    // x.com/intent/post is the current canonical composer; twitter.com/intent/tweet still
    // works but takes an extra redirect, which is one more thing to fail on a phone.
    function xIntentUrl(text){ return "https://x.com/intent/post?text="+encodeURIComponent(text); }
    // Mac users do not press Ctrl. Getting this wrong is the difference between the hint
    // helping and it reading as instructions for somebody else's computer.
    const PASTE_KEY = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent) ? "⌘V" : "Ctrl+V";

    function offerXLink(text){
      const wrap=document.querySelector("#cardPreview .cardBtns"); if(!wrap) return;
      let a=$("cardXOpen");
      if(!a){ a=document.createElement("a"); a.id="cardXOpen"; a.className="btn"; a.target="_blank"; a.rel="noopener"; wrap.prepend(a); }
      a.href=xIntentUrl(text); a.textContent="𝕏 OPEN X — THEN PASTE";
      toast("Card copied — open X and press "+PASTE_KEY, CYAN);
    }

    let _postingX=false;
    async function postCardToX(snap){
      if(_postingX) return;
      _postingX=true;
      const s=snap||snapshot();
      const link=refLink();
      const text=s.text+(link?("\n"+link):"");
      try{
        if(!(navigator.clipboard && window.ClipboardItem)) throw new Error("no image clipboard");
        const canvas=drawCard(s.data);
        const blobP=new Promise((res,rej)=>canvas.toBlob(b=>b?res(b):rej(new Error("no blob")),"image/png"));
        await navigator.clipboard.write([new ClipboardItem({"image/png":blobP})]);
        const w=window.open(xIntentUrl(text),"_blank","noopener");
        if(w) toast("Card copied — press "+PASTE_KEY+" in the post ✅", TEAL);
        else offerXLink(text);
      }catch(e){
        // no clipboard-image support (older Firefox), denied permission, or an
        // unfocused document — fall back to the save-and-caption path.
        toast("Couldn't copy the image — saving it instead", GOLD);
        try{ await shareCard(s); }catch(_){}
      }finally{ _postingX=false; }
    }
    window.__postCardToX = postCardToX;

    // Preview the card full-screen before sharing — people share far more when they can
    // see what they're about to post.
    function previewCard(){
      let ov=$("cardPreview");
      if(!ov){
        ov=document.createElement("div"); ov.id="cardPreview"; ov.className="overlay hidden";
        // ONE share button, not two. Both routes end at "this card, posted", so offering
        // them side by side just asks the player to guess which one works on their device.
        // Pick the better route here and label the button with what it will actually do:
        // where the OS share sheet takes files (phones) that is one tap to X with the image
        // already attached; where it does not (desktop) it degrades to a download, so the
        // copy-and-paste route wins. SAVE PNG stays as the quiet "just give me the file".
        const canSheet = !!(navigator.canShare && navigator.canShare({files:[new File([new Blob()],"x.png",{type:"image/png"})]}) && navigator.share);
        ov.innerHTML='<div class="cardWrap"><img id="cardImg" alt="Your XZILLA score card"/>'+
          '<div class="cardBtns">'+
            (canSheet
              ? '<button class="btn" id="cardShare">📣 SHARE CARD</button>'
              // The hint rides ON the button: by the time the composer opens the player is
              // looking at X, not at this screen, and a card sitting unpasted on the
              // clipboard is invisible. Say what to press before they leave.
              : '<button class="btn" id="cardShare">𝕏 POST ON X'+
                  '<span class="btnHint">copies the card — press '+PASTE_KEY+' in the post</span></button>')+
            '<button class="btn secondary small" id="cardSave">💾 SAVE PNG</button>'+
            '<button class="btn secondary small" id="cardClose">CLOSE</button>'+
          '</div></div>';
        ov._canSheet = canSheet;
        document.body.appendChild(ov);
        ov.addEventListener("click", ev=>{ if(ev.target===ov) ov.classList.add("hidden"); });
      }
      const snap=snapshot();   // freeze now — the caller may restore run state the moment we return
      try{ $("cardImg").src = drawCard(snap.data).toDataURL("image/png"); }catch(_){}
      ov.classList.remove("hidden");
      { const a=$("cardXOpen"); if(a) a.remove(); }   // clear any leftover popup-blocked link
      $("cardShare").onclick = ()=> ov._canSheet ? shareCard(snap) : postCardToX(snap);
      $("cardSave").onclick  = ()=> saveCard(snap);
      $("cardClose").onclick = ()=> ov.classList.add("hidden");
    }

    /* ====================================================================== *
     *  2. DAILY RUG RUN                                                       *
     *  One seed per UTC day, one attempt, one board. The seed is derived from *
     *  the date string alone, so every client computes it independently — no  *
     *  server round-trip needed to start, and no way to peek at tomorrow's.   *
     * ====================================================================== */
    const DRUN_KEY="xz_dailyrun_v1";
    // Named `drun`, not `daily`, because an unrelated `daily` (the daily CHALLENGE) already
    // lives in the enclosing scope — shadowing it here would be a live trap for later edits.
    const drun = {
      active:false,          // is the current/just-finished run a daily attempt?
      day:utcDay(),
      rank:0,
      rec:store.get(DRUN_KEY, null),   // {day, score, rank, ts, tag} for the last day played
      serverPlayed:null,               // server's answer: true/false, or null = not asked yet
    };
    /* Whose attempt is the stored local record?
     * The lock belongs to the ACCOUNT, not the browser. Without this, signing in with a
     * second account on the same device stayed locked out (the local record was blindly
     * trusted), and the same account on a second device wasn't locked at all. The server
     * is authoritative for signed-in players — drun.serverPlayed carries its answer —
     * while the local record still covers guests, who have no server-side identity.
     *
     * `tag` is the identity marker rather than pid because it is the one identifier BOTH
     * Telegram and web players reliably learn (see setMyTag). */
    function localLock(){
      const r = drun.rec;
      if(!r || r.day !== utcDay()) return false;
      // A record left by a DIFFERENT account must not lock the current one.
      if(myTag && r.tag && r.tag !== myTag) return false;
      // A signed-in player must not inherit a guest's attempt from this device.
      if(myTag && !r.tag) return false;
      return true;
    }
    function dailyPlayedToday(){
      if(drun.serverPlayed === true)  return true;    // server is authoritative when signed in
      if(drun.serverPlayed === false) return false;
      return localLock();                             // guest, or server not consulted yet
    }

    /* Ask the server whether this account has already run today, then repaint the card.
     * Runs on boot and on every auth change, so switching accounts re-evaluates. */
    function refreshDailyStatus(){
      const api = lbApi();
      if(!api || !signedIn()){ drun.serverPlayed = null; renderDailyCard(); return; }
      fetch(api+"/daily-status", { method:"POST", headers:authHeaders(),
        body: JSON.stringify({ initData: tgInitData() }) })
        .then(r=>r.ok?r.json():null).then(d=>{
          if(!d || d.anon) return;
          setMyTag(d.you);
          drun.serverPlayed = !!d.played;
          if(d.played){
            // Adopt the server's record so the card can show the real score/rank even on
            // a device where this account has never played.
            drun.rec = Object.assign({}, drun.rec, { day:d.day, score:d.score, rank:d.rank, tag:d.you });
            store.set(DRUN_KEY, drun.rec);
          }
          renderDailyCard();
        }).catch(()=>{});   // offline: fall back to the local record
    }
    function dailySeed(day){ return hashSeed("xzilla-daily-"+day); }

    // Four separate pre-run hooks are registered on startBtn across this file (resetRun,
    // the SET-2 reset, the ad refresh, and ours). Calling startGame() directly would skip
    // all of them and leave last run's state in place, so a daily run goes through the
    // real button and rides the normal ordering. _startingDaily tells our own listener to
    // stand down so it doesn't immediately clear the flag it's about to need.
    let _startingDaily=false;
    function startDailyRun(){
      if(dailyPlayedToday()){ toast("Daily run already used — back at 00:00 UTC", GOLD); return; }
      drun.day  = utcDay();
      drun.rank = 0;
      const btn=$("startBtn"); if(!btn) return;
      _startingDaily=true;
      try{ btn.click(); } finally { _startingDaily=false; }
      drun.active = true;
      window.__pumpMult = pump.mult;                     // the chart bonus applies to dailies too
      window.__rng = mulberry32(dailySeed(drun.day));   // every gameplay draw now comes from here
      showBanner("DAILY RUG RUN · "+drun.day);
      toast("Same scams for everyone today — one shot 🦖", CYAN);
    }

    /* GRACE WINDOW — a run that ends almost immediately does NOT burn the daily attempt.
     * One shot per day is what makes the score worth comparing, but a lane-dodger can end
     * in three seconds to one mistimed swipe, and "locked out for 24h" after three seconds
     * reads as a bug rather than a rule. Below the threshold the attempt is silently
     * returned; above it the result stands however bad it was.
     * Deliberately NOT posted to the server either — a graced run never existed. */
    const GRACE_SECS = 15;

    // Record + post the finished daily attempt. Local record is written FIRST so the
    // one-attempt lock holds even if the network call fails.
    function finishDailyRun(){
      const lasted = state.elapsed || 0;
      if(lasted < GRACE_SECS){
        toast("Run too short — daily attempt not used 🦖", TEAL);
        showBanner("ATTEMPT REFUNDED");
        drun.active = false;   // the card must render as a normal run, not a daily entry
        return false;          // no local record, no submit → the button stays live
      }
      const score=Math.round(state.score||0);
      // Stats are stored alongside the score so re-sharing the card tomorrow morning
      // still shows the real run, not a zeroed-out one.
      drun.rec={ day:drun.day, score, rank:0, ts:Date.now(), tag:myTag||null,
                  kills:run.kills|0, combo:run.combo|0, boss:run.boss|0 };
      drun.serverPlayed = signedIn() ? true : null;
      store.set(DRUN_KEY, drun.rec);
      const api=lbApi();
      if(!api || !signedIn()) return true;   // guests still get a local daily; posting needs an identity
      fetch(api+"/daily-submit",{ method:"POST", headers:authHeaders(),
        body:JSON.stringify({ initData:tgInitData(), score, day:drun.day,
                              wallet:connectedWallet(), stats:runStats() }) })
        .then(r=>r.json()).then(d=>{
          if(d) setMyTag(d.you);
          if(d && d.rank){
            drun.rank=d.rank;
            drun.rec.rank=d.rank; store.set(DRUN_KEY, drun.rec);
            const el=$("goDailyRank");
            if(el){ el.textContent="🗓 DAILY RANK #"+d.rank+(d.players?(" of "+d.players):""); el.style.color=CYAN; }
            renderDailyCard();   // the menu card can now show the world rank too
          }
        }).catch(()=>{});
      return true;
    }

    // Start-screen card: the button, or today's result plus a countdown.
    function renderDailyCard(){
      const host=$("dailyCard"); if(!host) return;
      const played=dailyPlayedToday();
      // Compact layout: the title and the countdown share one row instead of bookending
      // the card, and the three explainer lines collapse to one. Same information, and
      // the start screen no longer needs scrolling to reach the buttons below it.
      if(!played){
        host.innerHTML=
          '<div class="cardTop"><span class="dailyHead">🗓 DAILY RUG RUN</span>'+
            '<span class="dailySub dim" id="dailyClock"></span></div>'+
          '<button class="btn daily" id="dailyBtn">▶ PLAY TODAY’S RUN</button>'+
          '<div class="dailySub dim">Same seed for everyone · first '+GRACE_SECS+'s are free</div>';
        $("dailyBtn").onclick=startDailyRun;
      } else {
        host.innerHTML=
          '<div class="cardTop"><span class="dailyHead">🗓 DAILY · DONE</span>'+
            '<span class="dailySub dim" id="dailyClock"></span></div>'+
          '<div class="dailyDone"><span class="dailyScore">'+fmt(drun.rec.score)+'<span> pts</span></span>'+
            (drun.rec.rank ? '<span class="dailyRank">#'+drun.rec.rank+' world</span>' : '')+'</div>'+
          '<button class="btn secondary small" id="dailyShare">📸 SHARE TODAY’S CARD</button>';
        // Rebuild the card from the stored result — the live run state is long gone, so
        // score/stats are temporarily swapped in for the draw and restored right after.
        $("dailyShare").onclick=()=>{
          const sv={score:state.score, k:run.kills, c:run.combo, b:run.boss, a:drun.active, r:drun.rank};
          state.score=drun.rec.score; run.kills=drun.rec.kills|0; run.combo=drun.rec.combo|0; run.boss=drun.rec.boss|0;
          drun.active=true; drun.rank=drun.rec.rank||0; drun.day=drun.rec.day;
          try{ previewCard(); }
          finally { state.score=sv.score; run.kills=sv.k; run.combo=sv.c; run.boss=sv.b; drun.active=sv.a; drun.rank=sv.r; }
        };
      }
      tickDailyClock();
    }
    let _clockT=null;
    function tickDailyClock(){
      clearInterval(_clockT);
      const paint=()=>{
        const el=$("dailyClock"); if(!el){ clearInterval(_clockT); return; }
        const ms=msToNextUtcDay();
        // Rolled past midnight UTC while the menu sat open → new seed, new attempt.
        if(drun.rec && drun.rec.day!==utcDay()){ renderDailyCard(); return; }
        // Short form: the countdown shares a row with the card title now, and "Resets in"
        // wrapped the title onto two lines at 300px. The clock glyph carries the meaning.
        el.textContent="⏱ "+hms(ms);
      };
      paint(); _clockT=setInterval(paint,1000);
    }

    /* ====================================================================== *
     *  3. PUMP MODE                                                           *
     *  The live $XZILLA chart sets a global score/XP modifier. Thresholds and  *
     *  multipliers are decided by the Worker, not here, so they can be retuned *
     *  without busting every player's game.js cache.                           *
     * ====================================================================== */
    const pump = { mode:"NORMAL", mult:1, xpMult:1, label:"", note:"", price:0, change:null, mcap:0, ok:false };
    window.__pumpMult = 1;

    function applyPump(d){
      if(!d || !d.ok) return;
      pump.mode=d.mode||"NORMAL";
      pump.mult=Number(d.mult)||1; pump.xpMult=Number(d.xpMult)||1;
      pump.label=d.label||""; pump.note=d.note||"";
      pump.price=Number(d.priceUsd)||0; pump.change=(typeof d.change24==="number")?d.change24:null;
      pump.mcap=Number(d.mcap)||0; pump.ok=true;
      // Never re-multiply a run that's already scoring — a mid-run swing would make the
      // leaderboard incomparable. The new modifier lands on the NEXT run.
      if(!state.running) window.__pumpMult=pump.mult;
      renderPumpBanner();
    }
    function fetchPump(){
      const api=lbApi(); if(!api) return;
      fetch(api+"/pump",{cache:"no-store"}).then(r=>r.json()).then(applyPump).catch(()=>{});
    }

    function renderPumpBanner(){
      const host=$("pumpBanner"); if(!host) return;
      if(!pump.ok){ host.style.display="none"; return; }
      host.style.display="block";
      // Dexscreener omits priceChange entirely on pairs with no recent trades, so
      // "no data" must render as a neutral dash — colouring it red would tell every
      // visitor the token is down when it simply hasn't traded.
      const hasChg = pump.change!=null;
      const up  = hasChg && pump.change>=0;
      const chg = hasChg ? ((up?"+":"")+pump.change.toFixed(1)+"% 24h") : "no 24h trades yet";
      const chgCol = hasChg ? (up?TEAL:RED) : "#9fb6c9";
      const col = pump.mode==="PUMP" ? MAG : pump.mode==="GREEN" ? TEAL : pump.mode==="BLOOD" ? RED : "#1f1840";
      host.style.borderColor=col;
      host.innerHTML=
        (pump.label ? '<div class="pumpMode" style="color:'+col+'">'+pump.label+'</div>' : '')+
        (pump.note  ? '<div class="pumpNote">'+escapeHtml(pump.note)+'</div>' : '')+
        '<div class="pumpRow">'+
          '<span>$XZILLA</span>'+
          '<b style="color:'+chgCol+'">'+chg+'</b>'+
        '</div>'+
        '<div class="pumpRow">'+
          (pump.price ? '<span class="pumpMc">$'+pump.price.toPrecision(3)+'</span>' : '')+
          (pump.mcap  ? '<span class="pumpMc">MC $'+abbr(pump.mcap)+'</span>' : '')+
        '</div>';
    }

    /* ====================================================================== *
     *  WIRING                                                                 *
     * ====================================================================== */

    // ---- game over: daily bookkeeping, BLOOD-mode XP, and the card CTA ------
    const _prevGameOver = window.gameOver;
    window.gameOver = function(){
      const wasDaily = drun.active;
      _prevGameOver();
      drun.active = wasDaily;   // keep the flag alive for cardData() below

      // BLOOD MODE pays its XP bonus on everything the run earned, so it covers kill XP,
      // boss XP and the score bonus in one grant rather than being threaded through each.
      if(pump.xpMult>1 && run.earned>0){
        const bonus=Math.round(run.earned*(pump.xpMult-1));
        if(bonus>0){ econ.tokens+=bonus; run.earned+=bonus; saveEcon(); updateHUDtokens();
          toast((pump.label||"Red day")+" +"+fmt(bonus)+" XP", RED); }
      }

      // Consumed === the attempt actually counted. A run inside the grace window returns
      // false, leaving the card in its playable state so the player can go again.
      const consumed = wasDaily ? finishDailyRun() : false;
      if(wasDaily) renderDailyCard();

      const go=$("gameOverScreen"); if(!go) return;

      // daily rank line
      let dr=$("goDailyRank");
      if(!dr){ dr=document.createElement("div"); dr.id="goDailyRank"; dr.style.cssText="text-align:center;font-size:13px;margin:4px 0;letter-spacing:1px";
        const rk=$("goRank"); if(rk && rk.parentNode) rk.parentNode.insertBefore(dr, rk.nextSibling); }
      if(consumed){ dr.textContent="🗓 posting your daily rank…"; dr.style.color=CYAN; dr.style.display="block"; }
      else if(wasDaily){ dr.textContent="🗓 Too short to count — your daily run is still available"; dr.style.color=TEAL; dr.style.display="block"; }
      else { dr.textContent=""; dr.style.display="none"; }

      // the card CTA — the primary share action now, sitting with PLAY AGAIN
      const gb=go.querySelector(".go-buttons");
      if(gb && !$("goCardBtn")){
        const b=document.createElement("button");
        b.id="goCardBtn"; b.className="btn"; b.textContent="📸 SHARE SCORE CARD";
        gb.insertBefore(b, gb.firstChild.nextSibling || null);
        b.onclick=previewCard;
      }
      // The old text-only "SHARE YOUR RECORD" button on a new best now opens the card too.
      const nbBtn=$("goShareBest"); if(nbBtn){ nbBtn.textContent="📸 SHARE YOUR RECORD CARD"; nbBtn.onclick=previewCard; }

      // drun.active deliberately STAYS set here: the player shares the card after the run
      // ends, and cardData() needs to know it was a drun. The start/retry listener clears
      // it when the next run actually begins.
      window.__rng=null;         // release the seeded stream
    };

    // ---- a normal run must never inherit the daily seed ---------------------
    ["startBtn","retryBtn"].forEach(id=>{
      const b=$(id);
      if(b) b.addEventListener("click", ()=>{
        if(_startingDaily) return;              // this click IS the daily run — leave its state alone
        drun.active=false; window.__rng=null;
        window.__pumpMult=pump.mult;            // pick up any modifier that landed mid-session
      });
    });

    // ---- DAILY board inside the LEADERBOARD panel ---------------------------
    const _rl = renderLeaderboard;
    renderLeaderboard = function(){
      _rl();
      const host=$("leaderboardInner"); if(!host || !lbApi()) return;
      // ALWAYS re-fetch rather than bailing out when #lbDaily already exists. Today the
      // base renderLeaderboard() reassigns leaderboardInner.innerHTML first, which wipes
      // this block, so the old guard was never actually reached — this is defensive, not
      // a fix for a live bug. It matters if that wipe ever stops happening: the daily
      // board is live data and must reload every time the panel opens, or a player who
      // posts a score sees a stale "nobody has run today".
      let box=host.querySelector("#lbDaily");
      if(!box){
        box=document.createElement("div"); box.id="lbDaily";
        host.insertBefore(box, host.firstChild);
      }
      box.innerHTML='<h2 class="pnl-title" style="border-color:'+CYAN+';margin-top:4px;">🗓 DAILY RUG RUN · '+utcDay()+'</h2>'+
        '<div class="sub" id="lbDailyList">Loading today’s board…</div>';
      fetch(lbApi()+"/daily-top?day="+encodeURIComponent(utcDay()),{cache:"no-store"})
        .then(r=>r.json()).then(d=>{
          const list=(d&&d.top)||[]; const el=$("lbDailyList"); if(!el) return;
          if(!list.length){ el.textContent="Nobody has run today yet — be first on the board!"; return; }
          const dupes=dupeNamesIn(list);
          el.className=""; el.innerHTML=list.slice(0,10).map((e,i)=>{
            return '<div class="lrow'+(isMe(e)?' you':'')+'">'+
              '<span class="lrank">#'+(i+1)+'</span>'+
              '<span class="lname">'+boardName(e,dupes)+holderBadge(e)+'</span>'+
              '<b>'+fmt(e.score)+'</b></div>';
          }).join("")+
          '<div class="sub dim" style="margin-top:6px">'+(d.players||list.length)+' degen'+((d.players||list.length)===1?"":"s")+' ran today · resets 00:00 UTC</div>';
        }).catch(()=>{ const el=$("lbDailyList"); if(el) el.textContent="Daily board unavailable — retry later."; });
    };

    /* -------------------------------- boot ---------------------------------- */
    window.__refreshDailyStatus = refreshDailyStatus;
    renderDailyCard();
    renderLoginCard();
    refreshDailyStatus();
    // Validate any stored session token, then repaint (a dead token must not sit there
    // looking signed-in while every submit silently 401s).
    refreshAuth(()=>{ renderLoginCard(); refreshDailyStatus(); });
    fetchPump();
    // Re-poll every 5 min, and again whenever the player returns to the tab, so a
    // pump that starts mid-session is picked up without a reload.
    setInterval(fetchPump, 300000);
    document.addEventListener("visibilitychange", ()=>{ if(!document.hidden) fetchPump(); });
  })();

  /* -------------------------------- boot ---------------------------------- */
  // One-time cleanup: early builds granted a demo $XZILLA "bag" (e.g. 250000) that
  // got persisted in localStorage + CloudStorage. Holdings must only ever reflect a
  // REAL verified on-chain balance, so wipe any leftover pre-wallet holdings once.
  // Genuine holders simply reconnect their wallet to re-verify. Runs after the cloud
  // restore (in boot) and re-saves so the corrected snapshot wins on every device.
  function migrateEcon(){
    if(store.get("xz_mig_holdings",0) >= 1) return;
    if(econ.holdings>0){ econ.holdings=0; }
    store.set("xz_mig_holdings",1);
    saveEcon();
  }

  function boot(){
    migrateEcon();
    applySkin(); updateVip(); updateHUDtokens(); checkStreak();
    ensureDaily(); ensureWeekly(); syncRankSkins();   // refresh today's + this week's challenge + grant earned rank skins
    $("tabbar").classList.remove("hidden"); showTab("PLAY");
    { const mi=$("mainInvite"); if(mi) mi.onclick=inviteFriends; }   // main-screen invite CTA
    // Referrals: claim any pending inviter XP + process an incoming invite — but only once
    // the economy has fully loaded, so the XP grant can't be clobbered by a late restore.
    whenCloudReady(()=>{ try{ claimReferralRewards(); processIncomingReferral(); }catch(_){} });
  }
  // Pull any newer cross-device cloud save first, THEN boot (runs immediately outside Telegram).
  restoreEcon(boot);
})();
