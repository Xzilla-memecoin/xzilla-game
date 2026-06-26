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
   ENGINE AUDIO — real chopper-engine mp3.
   Replaces the synthesized V-twin by OVERRIDING the engine hooks that index.html
   already calls (startGame -> startEngine, the loop -> setEnginePitch, gameOver/
   quit -> stopEngine), so there is exactly ONE engine voice and it tracks run
   state (start / pause / resume / crash) without any double-audio.
   ========================================================================== */
(function engineAudio(){
  // Engine SFX is OFF for now — the chopper mp3 is being replaced with a better idle clip.
  // Re-enable by setting ENGINE_AUDIO = "mp3". "off" no-ops the hooks => full silence (also
  // bypasses the old synthesized V-twin), so nothing plays until a new sound is chosen.
  const ENGINE_AUDIO = "off";
  if(ENGINE_AUDIO !== "mp3"){ window.startEngine=function(){}; window.stopEngine=function(){}; window.setEnginePitch=function(){}; return; }
  const SRC = 'sounds/spinopel-the-accelerating-chopper-style-motorcycle-545712.mp3';
  const BASE_VOL = 0.4;
  const XFADE    = 0.6;          // seconds of head/tail OVERLAP that masks the loop seam → steady idle
  const maxSpeed = 24;           // reference top speed for the rev ramp (state.speed grows from baseSpeed 9)
  // A plain <audio loop> hard-cuts back to the start (the "re-accelerating" click). To get a
  // steady idle we run TWO elements of the same clip and crossfade the tail of one into the head
  // of the next, so there's never an audible seam.
  let a, b;
  try { a = new Audio(SRC); b = new Audio(SRC); } catch(_){ return; }
  [a,b].forEach(e=>{ e.loop=false; e.preload="auto"; e.volume=0; });
  let cur=a, nxt=b, started=false;
  const vol  = () => (state.soundOn ? BASE_VOL : 0);                                  // 0 when muted via the toggle
  const rate = () => (state.running && state.speed>0) ? 1.0 + Math.min(state.speed/maxSpeed,1)*0.25 : 1.0;

  // Run start = a real user gesture (the START tap), which clears the browser autoplay guard.
  window.startEngine = function(){
    started = true;
    try{ cur.currentTime=0; cur.playbackRate=rate(); cur.volume=vol(); cur.play().catch(()=>{}); }catch(_){}
  };
  // Crash / quit to menu: cut both elements dead so nothing roars over the scoreboard.
  window.stopEngine = function(){
    try{ [a,b].forEach(e=>{ e.pause(); e.currentTime=0; e.volume=0; }); }catch(_){}
  };
  // Every frame from the loop: rev with screen speed, manage the crossfade loop + pause/resume + mute.
  window.setEnginePitch = function(){
    try{
      if(!state.running){ if(!a.paused||!b.paused){ a.pause(); b.pause(); } return; }  // freeze over menu/pause/over
      const v = vol(), r = rate();
      if(started && cur.paused) cur.play().catch(()=>{});                              // resume after a pause
      cur.playbackRate = r;
      const dur = cur.duration;
      if(dur && isFinite(dur) && cur.currentTime >= dur - XFADE){
        // overlap the tail of `cur` with the head of `nxt`, ramping volumes across the seam
        if(nxt.paused){ nxt.currentTime=0; nxt.play().catch(()=>{}); }
        nxt.playbackRate = r;
        const k = Math.min(1, (cur.currentTime - (dur - XFADE)) / XFADE);             // 0..1 fade progress
        cur.volume = v*(1-k); nxt.volume = v*k;
        if(k>=1){ cur.pause(); cur.currentTime=0; cur.volume=0; const t=cur; cur=nxt; nxt=t; }  // swap roles
      } else {
        cur.volume = v;
        if(!nxt.paused){ nxt.pause(); nxt.currentTime=0; nxt.volume=0; }              // safety: clear any stray nxt
      }
    }catch(_){}
  };
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

  /* -------------------------------- skins --------------------------------- */
  const SKINS = [
    {id:"default", name:"OG GREEN",      tint:null,   cost:0},
    {id:"violet",  name:"DEGEN VIOLET",  tint:MAG,    cost:1500},
    {id:"cyan",    name:"PAPERHAND ICE", tint:CYAN,   cost:4000},
    {id:"gold",    name:"PUMP GOLD",     tint:GOLD,   cost:9000},
    // RANK REWARDS — earned by reaching a milestone (best score), not bought with XP.
    {id:"blood",   name:"RUG RED",       tint:RED,    cost:0, rankReq:3500,  rankName:"WHALE WRECKER"},
    {id:"toxic",   name:"ONCHAIN GLOW",  tint:TEAL,   cost:0, rankReq:12000, rankName:"APEX PREDATOR"}
  ];
  // Recolor the WHOLE Xrider+bike to the skin's color. THREE's material.color only
  // MULTIPLIES the texture (can't brighten → muddy), so instead we bake a per-skin
  // texture: pixel = luminance × tint, preserving the silhouette + shading. We load the
  // source art from its own CORS image (NOT the in-scene texture) so we never bake the
  // loading PLACEHOLDER sprite into a skin. The default skin uses the untinted art.
  // Animated biker spritesheet: XzillaBiker.webp is a 5×4 grid (20 frames, 640×640).
  // We show one frame via texture repeat+offset and cycle frames in the render loop
  // (speed-linked, see #tire-anim). Relative path → loads from the local server now and
  // GitHub Pages once pushed (same-origin, so the skin recolor canvas isn't tainted).
  // 5×4 grid = 20 cells, but the last cell (bottom-right) is empty → cycle only 19 frames.
  const BIKER_URL="images/XzillaBiker.webp", BIKER_COLS=5, BIKER_ROWS=4, BIKER_FRAMES=19;
  window.__BIKER={cols:BIKER_COLS, rows:BIKER_ROWS, frames:BIKER_FRAMES};
  let _riderBase=null, _riderLoading=false, _riderOrigTex=null, _skinLastId=null, _skinRetry=0;
  const _skinTex={};
  function _ensureRiderBase(cb){
    if(_riderBase){ cb&&cb(); return; }
    if(_riderLoading) return;
    _riderLoading=true;
    const im=new Image(); im.crossOrigin="anonymous";
    im.onload=()=>{ _riderBase=im; _riderLoading=false; cb&&cb(); };
    im.onerror=()=>{ _riderLoading=false; };
    try{ im.src = BIKER_URL; }catch(e){ _riderLoading=false; }
  }
  function _frameRepeat(t){ if(t&&t.repeat) t.repeat.set(1/BIKER_COLS, 1/BIKER_ROWS); return t; }   // show a single frame
  function _riderTexFor(tint){   // tint=null → original (untinted) sheet
    if(tint){ if(_skinTex[tint]) return _skinTex[tint]; } else if(_riderOrigTex) return _riderOrigTex;
    if(!_riderBase) return null;
    let t;
    if(!tint){
      t=new THREE.Texture(_riderBase); t.needsUpdate=true;   // untinted sheet — no per-pixel work
    } else {
      const w=_riderBase.naturalWidth||_riderBase.width, h=_riderBase.naturalHeight||_riderBase.height;
      const c=document.createElement("canvas"); c.width=w; c.height=h;
      const x=c.getContext("2d"); x.drawImage(_riderBase,0,0,w,h);
      let id; try{ id=x.getImageData(0,0,w,h); }catch(e){ return null; }
      const d=id.data, col=new THREE.Color(tint), tr=col.r, tg=col.g, tb=col.b;
      for(let i=0;i<d.length;i+=4){
        let a=d[i+3]; if(!a) continue;
        // Fade the soft aura baked into the art so the skin colour doesn't form a halo.
        if(a<170){ a=Math.round(a*a/170); d[i+3]=a; if(!a) continue; }
        let lum=(0.299*d[i]+0.587*d[i+1]+0.114*d[i+2])/255;
        lum=Math.min(1, Math.pow(lum,0.72));          // brighten midtones, keep darks dark (no glow halo)
        d[i]=tr*255*lum; d[i+1]=tg*255*lum; d[i+2]=tb*255*lum; }
      x.putImageData(id,0,0);
      t=new THREE.CanvasTexture(c);
    }
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
  // The main/start screen shows a separate static <img id="heroImg"> (mainImage.webp),
  // not the 3D player — so recolor it too, the same way, so the menu reflects the skin.
  const _heroImgEl = document.getElementById("heroImg");
  const _heroUrl = _heroImgEl ? _heroImgEl.getAttribute("src") : null;
  let _heroBase=null, _heroLoading=false; const _heroData={};
  function _applyHeroSkin(tint){
    const hero=_heroImgEl; if(!hero || !_heroUrl) return;
    if(!tint){ if(hero.src!==_heroUrl) hero.src=_heroUrl; return; }   // default → original art
    if(_heroData[tint]){ hero.src=_heroData[tint]; return; }
    if(!_heroBase){
      if(_heroLoading) return; _heroLoading=true;
      const im=new Image(); im.crossOrigin="anonymous";
      im.onload=()=>{ _heroBase=im; _heroLoading=false; try{ _applyHeroSkin(tint); }catch(e){} };
      im.onerror=()=>{ _heroLoading=false; };
      im.src=_heroUrl; return;                                       // re-applies once loaded
    }
    try{
      const w=_heroBase.naturalWidth||_heroBase.width, h=_heroBase.naturalHeight||_heroBase.height;
      const c=document.createElement("canvas"); c.width=w; c.height=h;
      const x=c.getContext("2d"); x.drawImage(_heroBase,0,0,w,h);
      const id=x.getImageData(0,0,w,h), d=id.data, col=new THREE.Color(tint), tr=col.r, tg=col.g, tb=col.b;
      for(let i=0;i<d.length;i+=4){
        let a=d[i+3]; if(!a) continue;
        if(a<170){ a=Math.round(a*a/170); d[i+3]=a; if(!a) continue; }
        let lum=(0.299*d[i]+0.587*d[i+1]+0.114*d[i+2])/255;
        lum=Math.min(1, Math.pow(lum,0.72));
        d[i]=tr*255*lum; d[i+1]=tg*255*lum; d[i+2]=tb*255*lum; }
      x.putImageData(id,0,0);
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
    {id:"b",  text:"Defeat 3 Rug Bosses",        goal:3,     prog:0, reward:3000,  done:false, stat:"boss"},
    {id:"b2", text:"Defeat 15 Rug Bosses",       goal:15,    prog:0, reward:9000,  done:false, stat:"boss"},
    {id:"c",  text:"Land an x12 combo",          goal:12,    prog:0, reward:2500,  done:false, stat:"combo"},
    {id:"c2", text:"Land an x25 combo",          goal:25,    prog:0, reward:6000,  done:false, stat:"combo"},
    {id:"s",  text:"Score 6,000 in one run",     goal:6000,  prog:0, reward:5000,  done:false, stat:"score"},
    {id:"s2", text:"Score 12,000 in one run",    goal:12000, prog:0, reward:10000, done:false, stat:"score"},
    {id:"s3", text:"Score 18,000 in one run",    goal:18000, prog:0, reward:18000, done:false, stat:"score"}
  ];
  let missions = store.get("xz_missions", null);
  if(!Array.isArray(missions)) missions = DEFAULT_MISSIONS.map(m=>({...m}));
  else {
    // migrate older saves to the full 10-bounty set: keep earned progress by id,
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
    {type:"kills", goal:80,   reward:2500, text:g=>"Smash "+g+" scammers today"},
    {type:"score", goal:6000, reward:3000, text:g=>"Score "+fmt(g)+" in a single run"},
    {type:"boss",  goal:3,    reward:4000, text:g=>"Defeat "+g+" Rug Bosses today"},
    {type:"combo", goal:15,   reward:3500, text:g=>"Land an x"+g+" combo"}
  ];
  const todayStr = () => new Date().toDateString();
  let daily = store.get("xz_daily", null);
  function rollDaily(){
    const day=todayStr();
    const seed=[...day].reduce((a,c)=>a+c.charCodeAt(0),0);   // date-derived pick → same all day
    const pick=DAILY_POOL[seed%DAILY_POOL.length];
    daily={day, type:pick.type, goal:pick.goal, reward:pick.reward, text:pick.text(pick.goal), prog:0, done:false};
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
    {type:"kills", goal:600,   reward:14000, text:g=>"Smash "+fmt(g)+" scammers this week"},
    {type:"boss",  goal:20,    reward:16000, text:g=>"Defeat "+fmt(g)+" Rug Bosses this week"},
    {type:"score", goal:12000, reward:15000, text:g=>"Score "+fmt(g)+" in a single run this week"},
    {type:"combo", goal:25,    reward:13000, text:g=>"Land an x"+g+" combo this week"}
  ];
  const weekBucket = () => Math.floor(Date.now()/6048e5);   // ~1-week buckets (same as the weekly board)
  let weekly = store.get("xz_weekly", null);
  function rollWeekly(){
    const wk=weekBucket();
    const pick=WEEKLY_POOL[wk%WEEKLY_POOL.length];
    weekly={week:wk, type:pick.type, goal:pick.goal, reward:pick.reward, text:pick.text(pick.goal), prog:0, done:false};
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
  const SCORE_TITLES = [
    {score:100,   name:"SCAM SPOTTER"},
    {score:250,   name:"RUG DODGER"},
    {score:500,   name:"FUD SLAYER"},
    {score:1000,  name:"KOL CRUSHER"},
    {score:2000,  name:"DEGEN DESTROYER"},
    {score:3500,  name:"WHALE WRECKER"},
    {score:5500,  name:"CHAIN GUARDIAN"},
    {score:8000,  name:"KAIJU AWAKENED"},
    {score:12000, name:"APEX PREDATOR"},
    {score:18000, name:"XZILLA LEGEND"}
  ];
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
  floor.rotation.x=-Math.PI/2; floor.position.set(0,-1.45,-46); scene.add(floor);

  // Sun reflection streak on the floor
  const sunStreak = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeTex((x,S)=>{ const g=x.createLinearGradient(0,0,0,S);
      g.addColorStop(0,"rgba(255,122,208,0)"); g.addColorStop(.5,"rgba(255,122,208,0.55)"); g.addColorStop(1,"rgba(255,210,63,0)");
      x.fillStyle=g; x.fillRect(S*0.36,0,S*0.28,S); },128),
    transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, fog:false, opacity:0.6 }));
  sunStreak.scale.set(14,40,1); sunStreak.position.set(0,-1.2,-50); scene.add(sunStreak);

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
    const m = (state.combo>1?state.combo:1) * window.__mult();
    const gain = Math.round(base*m);
    state.score += gain; renderScore();
    popup(worldPos, "+"+gain, window.__mult()>1 ? GOLD : TEAL);
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
  function submitLeaderboard(){
    const api = lbApi(); if(!api) return;
    if(!(tg && tg.initData)) return;                 // need verifiable Telegram identity to post
    const score = Math.max(Math.round(state.best||0), Math.round(state.score||0), (myBest&&myBest.score)||0);
    if(score<=0) return;
    try{
      fetch(api + "/submit", { method:"POST", headers:{ "content-type":"application/json" },
        body: JSON.stringify({ initData: tg.initData, score }) })
        .then(r=>r.json()).then(d=>{
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
    const link  = window.__BOT_SHARE_URL || "";
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
    const link = window.__BOT_SHARE_URL || "";
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
    $("leaderboardInner").innerHTML =
      '<h2 class="pnl-title" style="border-color:'+GOLD+';margin-top:4px;">RANK MILESTONES</h2>'+
      '<div class="wcard" style="margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;">'+
        '<span class="hud-label">\u26a1 YOUR XP</span><b style="color:'+TEAL+';font-size:22px">'+fmt(econ.tokens)+'</b></div>'+
      '<div class="sub" style="margin-bottom:8px;">Best score: '+fmt(best)+' pts \u00b7 <span style="color:'+GOLD+'">'+(cur?cur.name:"UNRANKED")+'</span></div>'+
      SCORE_TITLES.map(t=>{
        const reached = best>=t.score;
        return '<div class="lrow" style="'+(reached?'border-color:'+GOLD+';background:rgba(255,210,63,.08);':'opacity:.55;')+'">'+
          '<span class="lrank" style="color:'+(reached?GOLD:'#9fb6c9')+'">'+(reached?"\u2605":"\u2022")+'</span>'+
          '<span class="lname">'+t.name+'</span>'+
          '<b style="color:'+(reached?GOLD:'#9fb6c9')+'">'+fmt(t.score)+'</b></div>';
      }).join("")+
      // bottom: progress toward the next milestone
      (next
        ? '<div class="mrow" style="margin-top:12px;border-color:'+GOLD+'">'+
            '<div class="mtop"><span>NEXT \u00b7 '+next.name+'</span><b style="color:'+GOLD+'">'+fmt(next.score)+'</b></div>'+
            '<div class="mbar"><i style="width:'+progPct.toFixed(0)+'%;background:'+GOLD+'"></i></div>'+
            '<div class="msub">'+fmt(best)+' / '+fmt(next.score)+' \u00b7 '+fmt(next.score-best)+' to go</div></div>'
        : '<div class="mrow done" style="margin-top:12px;border-color:'+TEAL+'"><div class="mtop"><span>MAX RANK REACHED \u2605</span><b style="color:'+TEAL+'">XZILLA LEGEND</b></div></div>');
  }
  function renderSkins(){
    $("skinsInner").innerHTML =
      '<h2 class="pnl-title" style="border-color:'+TEAL+'">SKIN SHOP · '+abbr(econ.tokens)+' XP</h2>'+
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
    _gameOver();
    // economy + missions + leaderboard
    run.score=Math.max(run.score, state.score);
    // run earnings were already added live during play; just persist now (D5: removed `econ.tokens += 0;` no-op)
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
    submitLeaderboard();  // post the best score to the cross-player board (if configured)
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

    /* ----- upgrade tree (persisted, spent in XP) ----------------------------- */
    const UPGRADES = [
      {id:"hp",    name:"REINFORCED SCALES", desc:"+1 max HP per level",       max:3, base:4000,  step:2.4},
      {id:"combo", name:"DIAMOND GRIP",      desc:"Wider combo window",        max:4, base:2500,  step:2.0},
      {id:"drop",  name:"DEGEN LUCK",        desc:"+15% XP per kill / lvl",max:4, base:3000,  step:2.1},
      {id:"pwr",   name:"POWER MAGNET",      desc:"Power-ups spawn more often", max:3, base:5000,  step:2.6},
      {id:"start", name:"HEAD START",        desc:"Begin each run with a shield",max:1, base:8000,  step:1}
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
    }
    applyUpgrades();

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

    /* ===== embedded enemy sprites (re-embedded from uploaded grid) ===== */
    (function applyEnemySprites(){
      const SPR = window.XZILLA_SPRITES; if(!SPR) return;
      const swap=(mat,key)=>{ if(!mat||!SPR[key]) return;
        const l=new THREE.TextureLoader();
        l.load(SPR[key], t=>{ t.encoding=THREE.sRGBEncoding;
          try{ t.anisotropy=4; }catch(_){}
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
      swap(matRug,"rugboss");
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
    const px = { slowUntil:0, x2Until:0, magUntil:0, rugHp:0, rugMax:0 };
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
    window.spawn = function(){
      // every 4th wave -> rug boss (replaces plain whale cadence). A 3s warning runs
      // first (rugWarnUntil) during which every ad-screen flashes "RUG INCOMING".
      if(rugPending && !active.some(a=>a.type===TYPE.RUGBOSS || a.type===TYPE.BOSS)){
        if(nowS() >= rugWarnUntil){ rugPending=false; window.__rugWarn=false; spawnRug(); return; }
        // still inside the warning window — fall through and spawn a normal enemy this tick
      }
      const e=getEntity(), wp=waveProfile(), r=Math.random();
      let cum=0;
      const place=(scale)=>{ e.hp=1; e.bhits=0;   // bhits: tracer rounds taken (3 => effect)
        e.sprite.position.set((Math.random()*2-1)*playHalfWidth,0.9,SPAWN_Z);
        e.prevZ=SPAWN_Z; e.sprite.scale.set(scale,scale,1); active.push(e); };

      // TEST: heart-shaped extra-life token — 2% of spawns
      cum += 0.02;
      if(r<cum){ e.type=TYPE.HEART; e.sprite.material=matHeart; place(2.3); return; }
      // power-up bucket
      cum += wp.powerChance;
      if(r<cum){
        const roll=Math.random();
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
      // holder (do-not-hit)
      cum += wp.holderChance;
      if(r<cum){ e.type=TYPE.HOLDER; e.sprite.material=myHolderMat; place(2.7); return; }
      // default scammer
      e.type=TYPE.SCAMMER; e.sprite.material=myScammerMats[(Math.random()*myScammerMats.length)|0];
      place(2.8);
    };

    function spawnRug(){
      const e=getEntity();
      // TEST: HP is scaled up so the auto-cannon visibly grinds the boss down
      // (each tracer chips 1 HP at ~20 rounds/sec) instead of popping it instantly.
      px.rugMax = (3 + Math.floor(state.wave/4)) * 8;   // grows over the run
      px.rugHp  = px.rugMax;
      e.type=TYPE.RUGBOSS; e.hp=px.rugHp; e.sprite.material=matRug;
      e.sprite.scale.set(6.8,6.8,1);
      e.sprite.position.set(0,1.9,SPAWN_Z-6); e.prevZ=e.sprite.position.z; active.push(e);
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
         && !rugPending && !active.some(a=>a.type===TYPE.RUGBOSS||a.type===TYPE.BOSS)){
        rugPending=true; rugWarnUntil=nowS()+3; window.__rugWarn=true;   // 3s "RUG INCOMING" ad-screen warning before the boss
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
      const bonus=Math.round(8 * tierScoreMult() * (powActive(px.x2Until)?2:1));
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
    const CANNON = { pool:[], live:[], cd:0, rate:0.05, speed:48, mat:null };
    // While ANY rug boss is on the field the whole game slows to this fraction of the
    // live speed (a consistent "wave-4 first-boss" feel); normal speed resumes once it dies.
    const BOSS_SLOW = 0.5;

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

    function fireBullet(boss){
      const b=getBullet();
      b.position.set(player.position.x, player.position.y+0.25, PLAYER_Z-0.6);
      // gentle lock-on so the stream reliably connects with the weaving boss
      b._vx=(boss.sprite.position.x-player.position.x)*0.85;
      b._vz=-CANNON.speed;
      burst(b.position.x,b.position.y,b.position.z,GOLD,1);   // muzzle spark (1 — keeps iOS fill-rate low at 20 shots/sec)
      playShot();                                             // one-shot per bullet
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
      const gain=Math.round(900*tierScoreMult()); state.score+=gain; renderScore();
      const tok=Math.round(800*dropMult); econ.tokens+=tok; run.earned+=tok; run.boss++;
      run.score=Math.max(run.score,state.score);
      popup(p,"+"+gain,GOLD); bigBanner("RUG SHREDDED");
      try{sfx.power();}catch(_){}
      hideRugBar(); clearBullets(); gunOff();
      for(let i=active.length-1;i>=0;i--){ const a=active[i];
        if(a!==e && a.type===TYPE.SCAMMER && !a.dead){ a.dead=true;
          const ap=a.sprite.position.clone(); burst(ap.x,ap.y,ap.z,MAG,5); freeEntity(a); } }
      try{ window.__buzz ? window.__buzz([60,40,120],"success") : (tg&&tg.HapticFeedback&&tg.HapticFeedback.notificationOccurred("success")); }catch(_){}
      // Space the NEXT boss at least 4 waves after this defeat, measured off the
      // post-reward score so the +900 (and farmed scammer points) can't immediately
      // re-trigger another boss.
      nextBossWave = (1 + Math.floor(state.score/150)) + 4;
      e.dead=true; freeEntity(e); updateHUDtokens();
      return true;
    }

    // Tracers pass through the good drops (power-ups + extra-life hearts) so you never
    // shoot away a reward. HODLER / HONEYPOT / DECOY are NOT here on purpose — shooting
    // those triggers their hazard effect after 3 rounds (see the collision branch below).
    const BULLET_PASS = {};
    [TYPE.SHIELD,TYPE.BOMB,TYPE.PWR_SLOW,TYPE.PWR_X2,TYPE.PWR_MAG,TYPE.HEART].forEach(t=>BULLET_PASS[t]=1);

    window.updateCannon = function(dt){
      // Freeze + flush + silence the gun whenever the run isn't live (pause / menu / over).
      if(!state.running){ if(CANNON.live.length) clearBullets(); gunOff(); return; }
      const boss=bossOnField();
      if(boss){
        ensureShotBuffer();   // make sure the cheap WebAudio shot is ready for sustained fire
        CANNON.cd-=dt;
        while(CANNON.cd<=0){ fireBullet(boss); CANNON.cd+=CANNON.rate; }   // playShot() per bullet
      } else { if(CANNON.live.length) clearBullets(); gunOff(); }

      for(let i=CANNON.live.length-1;i>=0;i--){ const b=CANNON.live[i];
        b.position.x+=b._vx*dt; b.position.z+=b._vz*dt;
        if(b.position.z<SPAWN_Z-8){ freeBullet(b); continue; }
        let hit=false, bossKilled=false;
        for(let j=active.length-1;j>=0;j--){ const a=active[j]; if(!a||a.dead) continue;
          if(BULLET_PASS[a.type]) continue;
          const ax=a.sprite.position.x, az=a.sprite.position.z;
          const rad=(a.type===TYPE.RUGBOSS)?2.6:1.25;
          if(Math.abs(b.position.x-ax)<rad && Math.abs(b.position.z-az)<rad){
            if(a.type===TYPE.RUGBOSS){ bossKilled=damageBoss(a); hit=true; break; }
            // Every OTHER target takes 3 tracer rounds; the 3rd triggers the SAME effect
            // you'd get by colliding with it (friendly fire on hodler/honeypot included).
            const ap=a.sprite.position.clone();
            if((a.bhits=(a.bhits||0)+1) < 3){
              burst(ap.x,ap.y,ap.z, (a.type===TYPE.HOLDER||a.type===TYPE.HONEYPOT)?RED:MAG, 3);
              hit=true; break;
            }
            a.dead=true;
            if(a.type===TYPE.SCAMMER){            // shredded -> combo + score, like catching it
              state.combo++; state.kills++; run.kills++; if(state.combo>run.combo) run.combo=state.combo;
              burst(ap.x,ap.y,ap.z,MAG,12); window.addScore(CFG.scammerPoints,ap); renderCombo();
              try{sfx.catch(state.combo);}catch(_){}
            } else if(a.type===TYPE.HOLDER){       // friendly fire -> hodler dies AND you lose a life
              burst(ap.x,ap.y,ap.z,RED,14); popup(ap,"SHOT A HODLER!",RED); loseLife(ap);
            } else if(a.type===TYPE.HONEYPOT){     // shot the trap -> it stings, lose a life
              burst(ap.x,ap.y,ap.z,RED,14); popup(ap,"SHOT A HONEYPOT!",RED); loseLife(ap);
            } else if(a.type===TYPE.DECOY){        // shot the fake airdrop -> combo wiped
              state.combo=0; renderCombo(); burst(ap.x,ap.y,ap.z,CYAN,14); popup(ap,"COMBO LOST",CYAN);
            }
            freeEntity(a); try{sfx.catch(1);}catch(_){}
            hit=true; break;
          }
        }
        if(bossKilled) break;   // clearBullets() already flushed the pool
        if(hit){ burst(b.position.x,b.position.y,b.position.z,GOLD,4); freeBullet(b); }
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
      if(e.type===TYPE.PWR_SLOW){ px.slowUntil=nowS()+4.5; burst(p.x,p.y,p.z,"#7df9ff",16); popup(p,"SLOW-MO",CYAN); showBanner("SLOW-MO"); try{sfx.power();}catch(_){} e.dead=true; freeEntity(e); return; }
      if(e.type===TYPE.PWR_X2){ px.x2Until=nowS()+6; burst(p.x,p.y,p.z,GOLD,16); popup(p,"SCORE ×2",GOLD); showBanner("DOUBLE SCORE"); try{sfx.power();}catch(_){} e.dead=true; freeEntity(e); return; }
      if(e.type===TYPE.PWR_MAG){ px.magUntil=nowS()+5; burst(p.x,p.y,p.z,MAG,16); popup(p,"MAGNET",MAG); showBanner("SCAMMER MAGNET"); try{sfx.power();}catch(_){} e.dead=true; freeEntity(e); return; }

      if(e.type===TYPE.SCAMMER){
        state.combo++; state.kills++; run.kills++; if(state.combo>run.combo) run.combo=state.combo;
        try{sfx.catch(state.combo);}catch(_){}
        burst(p.x,p.y,p.z,MAG,14); window.addScore(CFG.scammerPoints,p); renderCombo();
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
          a.dead=true; const ap=a.sprite.position.clone(); burst(ap.x,ap.y,ap.z,MAG,6); state.kills++; run.kills++; window.addScore(CFG.scammerPoints,ap); freeEntity(a); } }
        e.dead=true; freeEntity(e); updateHUDtokens(); return;
      }
      // fallback
      e.dead=true; freeEntity(e);
    };

    /* ===================================================================== *
     *  FRAME HOOK — power-up effects + speed control + boss flair             *
     * ===================================================================== */
    const _origFrame = window.__frame;
    window.__frame = function(dt){
      if(_origFrame) _origFrame(dt);
      const t=nowS();
      // slow-mo scales the live speed the base loop just set this frame
      if(powActive(px.slowUntil)) state.speed *= 0.5;
      // TEST: while a rug boss is on the field, slow the whole game down. We scale CFG
      // (NOT state.speed) because index.html recomputes state.speed from CFG and moves
      // every enemy BEFORE this hook runs — so only a CFG change reaches the movement
      // math (next frame). Restored the instant the boss dies.
      if(state.running && bossOnField()){
        if(CFG._baseSave===undefined){ CFG._baseSave=CFG.baseSpeed; CFG._rampSave=CFG.speedRampPerSec; }
        CFG.baseSpeed=CFG._baseSave*BOSS_SLOW; CFG.speedRampPerSec=CFG._rampSave*BOSS_SLOW;
      } else if(CFG._baseSave!==undefined){
        CFG.baseSpeed=CFG._baseSave; CFG.speedRampPerSec=CFG._rampSave; CFG._baseSave=undefined;
      }
      // magnet: ease scammers toward the player's lane
      if(powActive(px.magUntil)){
        for(const a of active){ if(a.type===TYPE.SCAMMER && !a.dead){
          a.sprite.position.x += (player.position.x - a.sprite.position.x)*0.06; } }
      }
      // rug boss weave + bar follow
      for(const a of active){ if(a.type===TYPE.RUGBOSS){
        a.sprite.position.x = Math.sin(t*2.4)*1.1; } }
      // self-heal: if the boss left the screen un-defeated (dodged), its health bar must
      // not linger — hide it whenever there is no boss on the field.
      { const bar=$("rugBar");
        if(bar && bar.style.display!=="none" && !active.some(a=>a.type===TYPE.RUGBOSS||a.type===TYPE.BOSS)) hideRugBar(); }
      // TEST: auto-cannon — fire + advance + collide tracer rounds while a boss lives
      if(window.updateCannon) window.updateCannon(dt);
      // active-buff HUD ticker
      renderBuffs(t);
    };

    /* small buff indicator under the bag readout ----------------------------- */
    function renderBuffs(t){
      let el=$("buffRow");
      if(!el){ el=document.createElement("div"); el.id="buffRow";
        el.style.cssText="position:fixed;right:14px;top:118px;z-index:21;display:flex;gap:6px;"+
          "font:9px 'Press Start 2P',monospace;pointer-events:none";
        document.body.appendChild(el); }
      const parts=[];
      if(powActive(px.slowUntil)) parts.push('<span style="color:#7df9ff">⏳'+Math.ceil(px.slowUntil-t)+'</span>');
      if(powActive(px.x2Until))   parts.push('<span style="color:'+GOLD+'">✕2 '+Math.ceil(px.x2Until-t)+'</span>');
      if(powActive(px.magUntil))  parts.push('<span style="color:'+MAG+'">🧲'+Math.ceil(px.magUntil-t)+'</span>');
      // P2: this runs every frame — only touch the DOM when the rendered string
      // actually changes (idle frames, and the 59/60 frames between countdown ticks),
      // eliminating a per-frame innerHTML parse + layout recalc.
      const html=parts.join(" ");
      if(html!==el._lastHtml){
        el.innerHTML=html; el._lastHtml=html;
        el.style.display = parts.length? "flex":"none";
      }
    }

    /* ===================================================================== *
     *  WIDEN CATCH on combo upgrade — patch the loop's catch test indirectly  *
     *  The base loop uses a fixed catchX; we can't edit it, but we can pull    *
     *  near-miss scammers in slightly when DIAMOND GRIP is owned.             *
     * ===================================================================== */
    (function(){
      const grip = window.__catchBonus||0;
      if(grip<=0) return;
      const prevF = window.__frame;
      window.__frame = function(dt){
        prevF(dt);
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
      px.slowUntil=px.x2Until=px.magUntil=0; rugPending=false; nextBossWave=4; rugWarnUntil=0; window.__rugWarn=false;
      hideRugBar();
      if(lvl("start")>0){ shieldActive=true; }
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
        '<h2 class="pnl-title" style="border-color:'+GOLD+'">UPGRADE TREE · '+abbr(econ.tokens)+' XP</h2>'+
        '<div class="sub">Holdings tier <b style="color:'+tier.c+'">'+tier.l+'</b> · '+tier.m+'× score · '+
          (tierDropMult()).toFixed(2)+'× token drops</div>'+
        UPGRADES.map(u=>{
          const cur=lvl(u.id), maxed=cur>=u.max, cost=upgCost(u);
          const can=!maxed && econ.tokens>=cost;
          const pips = Array.from({length:u.max},(_,i)=>
            '<span style="display:inline-block;width:14px;height:8px;margin-right:3px;border-radius:3px;'+
            'background:'+(i<cur?GOLD:"#2a2150")+'"></span>').join("");
          return '<div class="mrow'+(maxed?' done':'')+'">'+
            '<div class="mtop"><span>'+u.name+'</span><b style="color:'+(maxed?TEAL:GOLD)+'">'+
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
        const mine = myBest && myBest.name;
        // no-store: always pull the freshest board so a cached response can't show stale order
        fetch(lbApi()+"/top", { cache:"no-store" }).then(r=>r.json()).then(d=>{
          const list=(d && d.top) || []; const el=$("lbTopList"); if(!el) return;
          if(!list.length){ el.textContent="No scores yet — be the first to rank!"; return; }
          el.className=""; el.innerHTML=list.map((e,i)=>{
            const me = mine && e.name===mine;
            const t  = titleForScore(e.score);   // each player's rank milestone, derived from their score
            return '<div class="lrow'+(me?' you':'')+'">'+
              '<span class="lrank">#'+(i+1)+'</span>'+
              '<span class="lname">'+escapeHtml(e.name)+(t?' · <span style="color:'+GOLD+'">'+t.name+'</span>':'')+'</span>'+
              '<b>'+fmt(e.score)+'</b></div>';
          }).join("");
        }).catch(()=>{ const el=$("lbTopList"); if(el) el.textContent="Global rankings unavailable — retry later."; });
      }

      // append a social strip below the existing rankings
      if(host.querySelector("#lbSocial")) return;
      const wrap=document.createElement("div"); wrap.id="lbSocial";
      wrap.style.cssText="margin-top:14px;display:flex;flex-direction:column;gap:8px";
      wrap.innerHTML=
        '<div class="sub" style="margin-top:2px">PLAY WITH FRIENDS</div>'+
        '<button class="btn secondary" id="lbInvite" style="font-size:11px;padding:13px">INVITE A DEGEN (+500 XP)</button>'+
        '<button class="btn secondary" id="lbShare" style="font-size:11px;padding:13px">SHARE MY RANK</button>'+
        (lbApi() ?
          '<div class="sub" style="margin-top:6px">POST THE LEADERBOARD</div>'+
          '<button class="btn secondary" id="lbPostTg" style="font-size:11px;padding:13px">📣 POST TOP 10 TO TELEGRAM</button>'+
          '<button class="btn secondary" id="lbPostX" style="font-size:11px;padding:13px">𝕏 POST TOP 5 TO X</button>'
          : '<div class="sub" style="opacity:.7">Global TOP 10 activates once the $XZILLA leaderboard backend is connected.</div>');
      host.appendChild(wrap);
      $("lbInvite").onclick=()=>{
        const link = window.__BOT_SHARE_URL || "";
        const txt  = "🦖 Hunt scammers with me in XZILLA: RUG SMASHER — climb the global leaderboard! 👇";
        try{
          if(tg && tg.openTelegramLink){ tg.openTelegramLink("https://t.me/share/url?url="+encodeURIComponent(link)+"&text="+encodeURIComponent(txt)); }
          else { navigator.clipboard.writeText(txt + (link?("\n"+link):"")); toast("Invite copied",CYAN); }
          // local referral reward (server should be the real source of truth)
          if(!store.get("xz_invited_once",false)){
            econ.tokens+=500; saveEcon(); updateHUDtokens(); store.set("xz_invited_once",true);
            toast("+500 XP — first invite bonus",GOLD);
          }
        }catch(e){ toast("Share unavailable",RED); }
      };
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

      function profile(a){
        const ty=a.type;
        let p={ amp:0.045, spd:3.2, breath:0.018, squash:0.025, baseY:0.9 };
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
        heat.style.opacity = (heatVal*0.55).toFixed(3);
        // hue teal -> magenta -> gold as heat climbs
        const hue = 175 - heatVal*135;             // 175(teal) .. 40(gold)
        heat.style.background =
          "radial-gradient(ellipse at center,rgba(0,0,0,0) 42%,"+
          "hsla("+hue+",100%,55%,"+(0.5*heatVal).toFixed(3)+") 100%)";
        if(bloomPass) bloomPass.strength = BLOOM_BASE + heatVal*0.95;
        if(scene.fog && fogBase) scene.fog.color.copy(fogBase).lerp(fogHot, heatVal*0.7);

        // speed lines — only while running and fast
        const sv = state.running ? clamp((state.speed-8)/16,0,1) : 0;
        speed.style.opacity = (sv*0.5).toFixed(3);

        // number-rolling score
        if(typeof state.score==="number"){
          const d=state.score-dispScore;
          if(Math.abs(d)<0.5) dispScore=state.score; else dispScore+=d*0.2;
          if(el && el.score){
            el.score.textContent=Math.floor(dispScore).toLocaleString();
            if(d>4){ el.score.classList.add("pump"); clearTimeout(el.score._pt);
              el.score._pt=setTimeout(()=>el.score.classList.remove("pump"),90); }
          }
        }
      };

      // reset heat/score on new run
      ["startBtn","retryBtn"].forEach(id=>{ const b=$(id);
        if(b) b.addEventListener("click",()=>{ heatVal=0; dispScore=0; freezeUntil=0;
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
      function drawAd(scr,msg,color,imageUrl){
        const x=scr.ctx,W=scr.canvas.width,H=scr.canvas.height;
        const img=adImage(imageUrl);
        const text=String(msg==null?"":msg).trim();
        // IMAGE-ONLY: an ad with an image and no caption → full-bleed banner (no scrim, no text).
        if(!text && img && img._ready){
          x.fillStyle="#05030f"; x.fillRect(0,0,W,H);
          x.drawImage(img,0,0,W,H);
          x.strokeStyle=color||"#21e6ff"; x.lineWidth=6; x.strokeRect(5,5,W-10,H-10);
          x.shadowBlur=0; scr.tex.needsUpdate=true; return;
        }
        // Background: cached ad image if decoded, else the solid neon-dark panel.
        if(img&&img._ready){
          x.fillStyle="#05030f"; x.fillRect(0,0,W,H);          // base under transparent/letterboxed art
          x.globalAlpha=0.6; x.drawImage(img,0,0,W,H); x.globalAlpha=1;
          x.fillStyle="rgba(5,3,15,0.35)"; x.fillRect(0,0,W,H); // scrim so text stays legible
        } else {
          x.fillStyle="#05030f"; x.fillRect(0,0,W,H);
        }
        x.strokeStyle=color; x.lineWidth=6; x.strokeRect(5,5,W-10,H-10);
        x.fillStyle=color; x.shadowColor=color; x.shadowBlur=18;
        x.textAlign="center"; x.textBaseline="middle";
        const words=String(msg).split(" ");
        let fontPx=Math.max(14,Math.round(W/9)), lines=[], lh=32;   // scale start size to screen width
        const minPx=Math.max(10,Math.round(W/22));
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
          if(lines.length*lh<=H-16) break;   // fits vertically at this size -> use it
        }
        x.font="bold "+fontPx+"px 'Press Start 2P',monospace";
        const y0=H/2-(lines.length-1)*lh/2;
        lines.forEach((ln,i)=>x.fillText(ln,W/2,y0+i*lh));
        x.shadowBlur=0; scr.tex.needsUpdate=true;
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
        const grp=groupFor(kind); m._msg=(Math.random()*grp.m.length)|0;
        drawAd(scr, grp.m[m._msg], grp.c[m._msg]||CYAN, grp.img[m._msg]);
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
          for(const s of adScreens){ const grp=groupFor(s._group); if(!grp.m.length) continue;
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

  // (Removed the rear-tire overlay: a vertical squash on a billboarded sprite read as
  //  jittering feet, not rotation. A real spinning illusion needs an animated tire
  //  sprite-sheet or a small procedural spinner — to revisit later.)

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
  }
  // Pull any newer cross-device cloud save first, THEN boot (runs immediately outside Telegram).
  restoreEcon(boot);
})();
