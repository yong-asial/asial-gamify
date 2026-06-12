/* Asial World — a tiny top-down explorer.
   Vanilla Canvas. Walk with arrows/WASD or click-to-move.
   Walk up to a building + press E (or click it) to read its info. */

(() => {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const mini = document.getElementById("minimap");
  const mctx = mini.getContext("2d");

  // ---- Sound (Web Audio, synthesized, deliberately quiet) ----
  const Sound = {
    ctx: null, master: null, on: true, _last: {},
    init() {
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.1; // low master volume
      this.master.connect(this.ctx.destination);
    },
    resume() { if (this.ctx && this.ctx.state === "suspended") this.ctx.resume(); },
    setOn(v) { this.on = v; if (this.master) this.master.gain.value = v ? 0.1 : 0; },
    _cool(key, ms) {
      if (!this.ctx) return false;
      const t = this.ctx.currentTime * 1000;
      if (this._last[key] && t - this._last[key] < ms) return false;
      this._last[key] = t; return true;
    },
    tone({ freq = 440, freq2 = null, type = "sine", dur = 0.1, vol = 0.5, attack = 0.005 }) {
      if (!this.ctx || !this.on) return;
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      const now = this.ctx.currentTime;
      o.type = type;
      o.frequency.setValueAtTime(freq, now);
      if (freq2) o.frequency.exponentialRampToValueAtTime(freq2, now + dur);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(vol, now + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      o.connect(g); g.connect(this.master);
      o.start(now); o.stop(now + dur + 0.02);
    },
    noise({ dur = 0.1, vol = 0.4, type = "lowpass", freq = 800, q = 1 }) {
      if (!this.ctx || !this.on) return;
      const n = Math.floor(this.ctx.sampleRate * dur);
      const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const src = this.ctx.createBufferSource(); src.buffer = buf;
      const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = this.ctx.createGain(); g.gain.value = vol;
      src.connect(f); f.connect(g); g.connect(this.master); src.start();
    },
    _step: 0,
    footstep() { if (!this._cool("foot", 140)) return; this._step ^= 1; this.noise({ dur: 0.07, vol: 0.16, type: "lowpass", freq: this._step ? 430 : 330, q: 0.8 }); },
    bump() { if (!this._cool("bump", 220)) return; this.tone({ freq: 150, freq2: 70, dur: 0.14, vol: 0.32 }); this.noise({ dur: 0.08, vol: 0.13, type: "lowpass", freq: 220 }); },
    rustle() { if (!this._cool("rustle", 260)) return; this.noise({ dur: 0.12, vol: 0.09, type: "highpass", freq: 2600, q: 0.6 }); },
    chime() { if (!this._cool("chime", 200)) return; this.tone({ freq: 660, dur: 0.12, vol: 0.26 }); this.tone({ freq: 990, dur: 0.22, vol: 0.2, attack: 0.012 }); },
    confirm() { this.tone({ freq: 520, freq2: 784, type: "triangle", dur: 0.18, vol: 0.28 }); },
  };

  // ---- State ----
  const state = {
    world: { w: 2800, h: 2000 },
    spawn: { x: 1100, y: 820 },
    pois: [],
    billboards: [],   // depth-sorted scenery (trees, houses, city, lamps, portals)
    flats: [],        // ground decals (ponds, flower beds, rocks)
    biomes: [],       // big soft color zones ("different universes")
    stars: [],        // parallax far-field motes
    particles: [],    // drifting multiverse glow-motes (screen space)
    player: { x: 1100, y: 820, r: 16, vx: 0, vy: 0, speed: 230, face: 1 },
    keys: new Set(),
    moveTarget: null,      // {x,y} world coords for click-to-move
    nearPoi: null,         // POI within interaction range
    camera: { x: 0, y: 0 },
    running: false,
    panelOpen: false,
    dpr: Math.min(window.devicePixelRatio || 1, 2),
    t: 0,
    footT: 0,
  };

  // ---- Sizing ----
  function resize() {
    state.dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(innerWidth * state.dpr);
    canvas.height = Math.floor(innerHeight * state.dpr);
    canvas.style.width = innerWidth + "px";
    canvas.style.height = innerHeight + "px";
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);

    mini.width = Math.floor(mini.clientWidth * state.dpr);
    mini.height = Math.floor(mini.clientHeight * state.dpr);
    mctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  }
  addEventListener("resize", resize);

  // ---- Load content ----
  fetch("content.json")
    .then((r) => r.json())
    .then((data) => {
      state.world = data.world || state.world;
      state.spawn = data.spawn || state.spawn;
      state.pois = data.pois || [];
      state.player.x = state.spawn.x;
      state.player.y = state.spawn.y;
      document.getElementById("start-intro").textContent =
        data.intro || "Explore Asial by walking around.";
      buildWorld();
      resize();
      requestAnimationFrame(loop);
    })
    .catch((err) => {
      document.getElementById("start-intro").textContent =
        "Failed to load content.json — serve this folder over http (see README).";
      console.error(err);
    });

  // ---- Input: keyboard ----
  const KEYMAP = {
    ArrowUp: "up", KeyW: "up",
    ArrowDown: "down", KeyS: "down",
    ArrowLeft: "left", KeyA: "left",
    ArrowRight: "right", KeyD: "right",
  };
  addEventListener("keydown", (e) => {
    if (e.code in KEYMAP) {
      state.keys.add(KEYMAP[e.code]);
      state.moveTarget = null; // keyboard cancels click-to-move
      e.preventDefault();
    }
    if (state.panelOpen) {
      if (e.code === "Escape") closePanel();
      else if (e.code === "Space" || e.code === "ArrowRight" || e.code === "Enter") {
        e.preventDefault(); panelStep(1);
      } else if (e.code === "ArrowLeft") { e.preventDefault(); panelStep(-1); }
      return;
    }
    if (e.code === "KeyE" && state.nearPoi) openPanel(state.nearPoi);
    if (e.code === "KeyM") toggleMute();
    if (e.code === "Escape" && !state.running) {} // ignore on start screen
  });
  addEventListener("keyup", (e) => {
    if (e.code in KEYMAP) state.keys.delete(KEYMAP[e.code]);
  });

  // ---- Input: mouse / touch ----
  function pointerToWorld(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) + state.camera.x,
      y: (clientY - rect.top) + state.camera.y,
    };
  }
  function handlePointer(clientX, clientY) {
    if (!state.running || state.panelOpen) return;
    const w = pointerToWorld(clientX, clientY);
    // Did we click on/near a POI? If so, open it (when close) or walk to it.
    const hit = state.pois.find((p) => {
      const top = p.y + p.h - p.vh; // visual extends above the footprint
      return w.x >= p.x - 24 && w.x <= p.x + p.w + 24 &&
             w.y >= top - 24 && w.y <= p.y + p.h + 24;
    });
    if (hit) {
      if (dist(state.player, poiCenter(hit)) < interactRange(hit)) {
        openPanel(hit);
        return;
      }
      // walk toward its front door
      state.moveTarget = { x: hit.x + hit.w / 2, y: hit.y + hit.h + 30 };
      return;
    }
    state.moveTarget = { x: w.x, y: w.y };
  }
  canvas.addEventListener("click", (e) => handlePointer(e.clientX, e.clientY));
  canvas.addEventListener("touchstart", (e) => {
    if (e.touches.length) {
      handlePointer(e.touches[0].clientX, e.touches[0].clientY);
      e.preventDefault();
    }
  }, { passive: false });

  // ---- Geometry helpers ----
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function poiCenter(p) { return { x: p.x + p.w / 2, y: p.y + p.h / 2 }; }
  function interactRange(p) { return Math.max(p.w, p.h) / 2 + 70; }
  function pointInPoi(x, y, p, pad = 0) {
    return x >= p.x - pad && x <= p.x + p.w + pad &&
           y >= p.y - pad && y <= p.y + p.h + pad;
  }
  // base footprint (world coords) for solid scenery; null = walk-through
  function scenerySolid(b) {
    const s = b.s || 1;
    switch (b.type) {
      case "house": return { x: b.x - 32 * s, y: b.y - 14 * s, w: 64 * s, h: 18 * s };
      case "city": { const w = b.w * s; return { x: b.x - w / 2, y: b.y - 12, w, h: 16 }; }
      case "pagoda": return { x: b.x - 18 * s, y: b.y - 10 * s, w: 36 * s, h: 14 * s };
      case "tokyoTower": return { x: b.x - 30 * s, y: b.y - 8, w: 60 * s, h: 12 };
      case "skytree": return { x: b.x - 14 * s, y: b.y - 8, w: 28 * s, h: 12 };
      case "ferris": return { x: b.x - 22 * s, y: b.y - 8, w: 44 * s, h: 12 };
      default: return null;
    }
  }

  // resolve circle-vs-rect: push player out of building footprint
  function collide(px, py, r, p) {
    const cx = Math.max(p.x, Math.min(px, p.x + p.w));
    const cy = Math.max(p.y, Math.min(py, p.y + p.h));
    const dx = px - cx, dy = py - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 >= r * r) return null;
    const d = Math.sqrt(d2) || 0.0001;
    const push = (r - d);
    return { x: px + (dx / d) * push, y: py + (dy / d) * push };
  }

  // ---- World generation (deterministic) ----
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // footprint [w, h, visualHeight] per POI kind
  const POI_FOOT = {
    torii: [120, 64, 104], trophy: [84, 54, 96], gears: [104, 80, 100],
    shop: [128, 64, 100], museum: [148, 76, 110], tower: [120, 80, 232],
    briefcase: [96, 56, 78], postman: [64, 52, 78],
  };

  function placePois(rng) {
    const W = state.world.w, H = state.world.h;
    const margin = 210, minSep = 360;
    const done = [];
    for (const p of state.pois) {
      const f = POI_FOOT[p.kind] || [120, 80, 100];
      p.w = f[0]; p.h = f[1]; p.vh = f[2];
      let ok = false;
      for (let a = 0; a < 800 && !ok; a++) {
        const x = margin + rng() * (W - 2 * margin - p.w);
        const y = margin + rng() * (H - 2 * margin - p.h);
        const ccx = x + p.w / 2, ccy = y + p.h / 2;
        if (Math.hypot(ccx - state.spawn.x, ccy - state.spawn.y) < 320) continue;
        let clash = false;
        for (const q of done) {
          if (Math.hypot(ccx - (q.x + q.w / 2), ccy - (q.y + q.h / 2)) < minSep) { clash = true; break; }
        }
        if (clash) continue;
        p.x = x; p.y = y; ok = true;
      }
      if (!ok) { p.x = margin + rng() * (W - 2 * margin - p.w); p.y = margin + rng() * (H - 2 * margin - p.h); }
      done.push(p);
    }
  }

  function buildWorld() {
    const rng = mulberry32(0x5eed);
    placePois(rng);
    const W = state.world.w, H = state.world.h;
    const cx = W / 2, cy = H / 2;
    const maxD = Math.hypot(cx, cy);

    // keep scenery off buildings, paths and spawn
    const clearOf = (x, y, pad) => {
      for (const p of state.pois) {
        if (x > p.x - pad && x < p.x + p.w + pad &&
            y > p.y - pad && y < p.y + p.h + pad) return false;
      }
      // keep the central plaza around spawn open
      if (Math.hypot(x - state.spawn.x, y - state.spawn.y) < 110) return false;
      return true;
    };

    const palette = ["#22d3ee", "#818cf8", "#f472b6", "#facc15", "#34d399", "#fb923c"];

    // Biome color zones — each suggests a "different universe"
    state.biomes = [
      { x: W * 0.18, y: H * 0.22, r: 520, color: "rgba(56,189,248,0.10)" },
      { x: W * 0.82, y: H * 0.20, r: 560, color: "rgba(167,139,250,0.10)" },
      { x: W * 0.16, y: H * 0.82, r: 540, color: "rgba(244,114,182,0.09)" },
      { x: W * 0.84, y: H * 0.83, r: 560, color: "rgba(52,211,153,0.10)" },
      { x: cx, y: cy, r: 420, color: "rgba(45,212,191,0.07)" },
    ];

    // Parallax far-field stars (drawn behind everything, drift slowly)
    state.stars = [];
    for (let i = 0; i < 220; i++) {
      state.stars.push({
        x: rng() * W * 1.4 - W * 0.2,
        y: rng() * H * 1.4 - H * 0.2,
        r: rng() * 1.6 + 0.4,
        tw: rng() * Math.PI * 2,
        hue: palette[(rng() * palette.length) | 0],
      });
    }

    const billboards = [];
    const flats = [];

    // Ground decals: ponds, flower beds, rocks
    for (let i = 0; i < 10; i++) {
      const x = rng() * W, y = rng() * H;
      if (!clearOf(x, y, 90)) continue;
      flats.push({ type: "pond", x, y, w: 90 + rng() * 130, h: 50 + rng() * 70 });
    }
    for (let i = 0; i < 60; i++) {
      const x = rng() * W, y = rng() * H;
      if (!clearOf(x, y, 50)) continue;
      flats.push({ type: "flowers", x, y, n: 4 + (rng() * 5 | 0), c: palette[(rng() * palette.length) | 0], s: rng() });
    }
    for (let i = 0; i < 40; i++) {
      const x = rng() * W, y = rng() * H;
      if (!clearOf(x, y, 40)) continue;
      flats.push({ type: "rock", x, y, s: 0.7 + rng() * 0.9, r: rng() });
    }

    const neon = ["#ff2d78", "#22d3ee", "#a855f7", "#facc15", "#f43f5e", "#38bdf8", "#34d399"];

    // Tall scenery by region: a dense neon Tokyo skyline at the edges,
    // machiya houses + sakura in the mid-ring, a sakura park near the campus.
    let attempts = 0, placed = 0;
    while (placed < 300 && attempts < 5000) {
      attempts++;
      const x = rng() * W, y = rng() * H;
      if (!clearOf(x, y, 54)) continue;
      const d = Math.hypot(x - cx, y - cy) / maxD; // 0 center .. 1 corner
      const roll = rng();
      let type;
      if (d > 0.58) type = roll < 0.82 ? "city" : (roll < 0.92 ? "house" : "sakura");
      else if (d > 0.32) type = roll < 0.4 ? "house" : (roll < 0.78 ? "sakura" : "pine");
      else type = roll < 0.62 ? "sakura" : (roll < 0.85 ? "tree" : "bush");

      const b = { type, x, y, s: 0.85 + rng() * 0.55, r: rng() };
      if (type === "city") {
        b.h = 150 + rng() * 230;
        b.w = 58 + rng() * 54;
        b.color = ["#101b33", "#15213b", "#1a1736", "#1d2742"][(rng() * 4) | 0];
        b.lit = neon[(rng() * neon.length) | 0];
        b.signOn = rng() < 0.75;
        b.sign = neon[(rng() * neon.length) | 0];
        b.signSide = rng() < 0.5 ? -1 : 1;
        b.signLen = 0.35 + rng() * 0.4;
      }
      billboards.push(b);
      placed++;
    }

    // Iconic Tokyo landmarks, placed out in the skyline ring
    const farSpot = (minD) => {
      for (let a = 0; a < 500; a++) {
        const x = rng() * (W - 200) + 100, y = rng() * (H - 200) + 100;
        if (!clearOf(x, y, 110)) continue;
        if (Math.hypot(x - cx, y - cy) / maxD < minD) continue;
        return { x, y };
      }
      return null;
    };
    for (const lk of ["tokyoTower", "skytree", "pagoda", "pagoda", "ferris"]) {
      const s = farSpot(0.5);
      if (s) billboards.push({ type: lk, x: s.x, y: s.y, s: 1, r: rng(), lit: neon[(rng() * neon.length) | 0] });
    }

    // Red paper lanterns (chochin) on poles, ringing the campus
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
      const rr = 360 + rng() * 70;
      const x = state.spawn.x + Math.cos(a) * rr;
      const y = state.spawn.y + Math.sin(a) * rr * 0.8;
      if (x < 30 || y < 30 || x > W - 30 || y > H - 30) continue;
      if (!clearOf(x, y, 28)) continue;
      billboards.push({ type: "lantern", x, y, s: 1, r: rng() });
    }

    // A few street torii gates scattered around
    for (let i = 0; i < 5; i++) {
      const x = rng() * W, y = rng() * H;
      if (!clearOf(x, y, 70)) continue;
      billboards.push({ type: "torii", x, y, s: 0.7 + rng() * 0.4, r: rng() });
    }

    // A few animated portal rings — gateways to "other universes"
    const portalSpots = [
      { x: W * 0.10, y: H * 0.50 }, { x: W * 0.90, y: H * 0.50 },
      { x: W * 0.50, y: H * 0.10 }, { x: W * 0.50, y: H * 0.92 },
    ];
    for (const s of portalSpots) {
      if (s.x < 40 || s.y < 40 || s.x > W - 40 || s.y > H - 40) continue;
      billboards.push({ type: "portal", x: s.x, y: s.y, s: 1, r: rng(),
        color: palette[(rng() * palette.length) | 0] });
    }

    state.billboards = billboards;
    state.flats = flats;

    // Screen-space falling sakura (cherry-blossom) petals
    const pinks = ["#ffd7e6", "#ffc0d4", "#ffb3cc", "#ff9ec0", "#ffe0ec"];
    state.particles = [];
    for (let i = 0; i < 80; i++) {
      state.particles.push({
        x: rng() * innerWidth, y: rng() * innerHeight,
        size: 4 + rng() * 4, fall: 18 + rng() * 26,
        sway: 12 + rng() * 18, ph: rng() * Math.PI * 2,
        rot: rng() * Math.PI * 2, vr: (rng() - 0.5) * 2,
        hue: pinks[(rng() * pinks.length) | 0],
      });
    }
  }

  function updateParticles(dt) {
    for (const m of state.particles) {
      m.y += m.fall * dt;
      m.x += Math.sin(state.t * 1.2 + m.ph) * m.sway * dt;
      m.rot += m.vr * dt;
      if (m.y > innerHeight + 12) { m.y = -12; m.x = Math.random() * innerWidth; }
      if (m.x < -12) m.x = innerWidth + 12;
      if (m.x > innerWidth + 12) m.x = -12;
    }
  }

  // ---- Update ----
  function update(dt) {
    const p = state.player;
    let dx = 0, dy = 0;
    if (state.keys.has("left")) dx -= 1;
    if (state.keys.has("right")) dx += 1;
    if (state.keys.has("up")) dy -= 1;
    if (state.keys.has("down")) dy += 1;

    if (dx || dy) {
      const len = Math.hypot(dx, dy) || 1;
      dx /= len; dy /= len;
    } else if (state.moveTarget) {
      const tx = state.moveTarget.x - p.x;
      const ty = state.moveTarget.y - p.y;
      const d = Math.hypot(tx, ty);
      if (d < 6) { state.moveTarget = null; }
      else { dx = tx / d; dy = ty / d; }
    }

    if (dx) p.face = dx < 0 ? -1 : 1;

    // footstep cadence while moving
    if (dx || dy) {
      state.footT += dt;
      if (state.footT >= 0.3) { state.footT = 0; Sound.footstep(); }
    } else { state.footT = 0.3; }

    let nx = p.x + dx * p.speed * dt;
    let ny = p.y + dy * p.speed * dt;

    // world bounds
    nx = Math.max(p.r, Math.min(state.world.w - p.r, nx));
    ny = Math.max(p.r, Math.min(state.world.h - p.r, ny));

    // building (POI) collisions
    for (const poi of state.pois) {
      const fixed = collide(nx, ny, p.r, poi);
      if (fixed) { nx = fixed.x; ny = fixed.y; Sound.bump(); }
    }
    p.x = nx; p.y = ny;

    // scenery: solid landmarks block (thud); foliage just rustles
    for (const b of state.billboards) {
      const ddx = b.x - p.x, ddy = b.y - p.y;
      if (ddx * ddx + ddy * ddy > 90000) continue; // skip far (~300px)
      const rect = scenerySolid(b);
      if (rect) {
        const fixed = collide(p.x, p.y, p.r, rect);
        if (fixed) { p.x = fixed.x; p.y = fixed.y; Sound.bump(); }
      } else if (b.type === "tree" || b.type === "sakura" || b.type === "pine" || b.type === "bush") {
        const rr = (b.type === "bush" ? 16 : 26) * (b.s || 1) + p.r * 0.5;
        if (ddx * ddx + ddy * ddy < rr * rr) Sound.rustle();
      }
    }

    // nearest interactable POI (chime when you first meet one)
    let near = null, best = Infinity;
    for (const poi of state.pois) {
      const d = dist(p, poiCenter(poi));
      if (d < interactRange(poi) && d < best) { best = d; near = poi; }
    }
    if (near && near !== state.nearPoi) Sound.chime();
    state.nearPoi = near;
    const promptEl = document.getElementById("prompt");
    promptEl.classList.toggle("hidden", !near || state.panelOpen);
    if (near) promptEl.innerHTML = `Press <kbd>E</kbd> or click to explore <b>${near.title}</b>`;

    // camera follows, clamped to world
    const camW = innerWidth, camH = innerHeight;
    state.camera.x = clamp(p.x - camW / 2, 0, Math.max(0, state.world.w - camW));
    state.camera.y = clamp(p.y - camH / 2, 0, Math.max(0, state.world.h - camH));
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // ---- Render ----
  function inView(x, y, m) {
    const cam = state.camera;
    return x > cam.x - m && x < cam.x + innerWidth + m &&
           y > cam.y - m && y < cam.y + innerHeight + m;
  }

  function draw() {
    const cam = state.camera;

    // 1. deep-space gradient backdrop (multiverse void)
    const g = ctx.createLinearGradient(0, 0, 0, innerHeight);
    g.addColorStop(0, "#0b1022");
    g.addColorStop(1, "#0f172a");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, innerWidth, innerHeight);

    // 2. parallax far-field stars (drift slower than camera = depth)
    const px = cam.x * 0.35, py = cam.y * 0.35;
    for (const s of state.stars) {
      const sx = s.x - px, sy = s.y - py;
      if (sx < -20 || sy < -20 || sx > innerWidth + 20 || sy > innerHeight + 20) continue;
      const a = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(state.t * 2 + s.tw));
      ctx.globalAlpha = a;
      ctx.fillStyle = s.hue;
      ctx.beginPath(); ctx.arc(sx, sy, s.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // 3. grass checkerboard ground
    const tile = 80;
    const sX = Math.floor(cam.x / tile) * tile;
    const sY = Math.floor(cam.y / tile) * tile;
    for (let gx = sX; gx < cam.x + innerWidth + tile; gx += tile) {
      for (let gy = sY; gy < cam.y + innerHeight + tile; gy += tile) {
        const even = ((gx / tile) + (gy / tile)) % 2 === 0;
        ctx.fillStyle = even ? "#15402a" : "#17492f";
        ctx.fillRect(gx - cam.x, gy - cam.y, tile, tile);
      }
    }

    // 4. biome color zones ("different universes")
    ctx.globalCompositeOperation = "lighter";
    for (const b of state.biomes) {
      if (!inView(b.x, b.y, b.r)) continue;
      const rg = ctx.createRadialGradient(b.x - cam.x, b.y - cam.y, 0, b.x - cam.x, b.y - cam.y, b.r);
      rg.addColorStop(0, b.color);
      rg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = rg;
      ctx.fillRect(b.x - cam.x - b.r, b.y - cam.y - b.r, b.r * 2, b.r * 2);
    }
    ctx.globalCompositeOperation = "source-over";

    // 5. paths from spawn to each building
    ctx.strokeStyle = "rgba(63,63,70,0.5)";
    ctx.lineWidth = 26;
    ctx.lineCap = "round";
    for (const poi of state.pois) {
      const c = poiCenter(poi);
      ctx.beginPath();
      ctx.moveTo(state.spawn.x - cam.x, state.spawn.y - cam.y);
      ctx.lineTo(c.x - cam.x, c.y - cam.y);
      ctx.stroke();
    }

    // 6. flat ground decals (ponds, flowers, rocks)
    for (const f of state.flats) {
      if (!inView(f.x, f.y, 160)) continue;
      drawFlat(f, cam);
    }

    // 7. depth-sorted billboards + POIs + player (painter's algorithm by feet-y)
    const list = [];
    for (const b of state.billboards) if (inView(b.x, b.y, 260)) list.push(b);
    for (const p of state.pois) list.push({ type: "poi", x: p.x + p.w / 2, y: p.y + p.h, poi: p });
    const pl = state.player;
    list.push({ type: "player", x: pl.x, y: pl.y + pl.r });
    list.sort((a, b) => a.y - b.y);
    for (const it of list) {
      if (it.type === "poi") drawPoi(it.poi, cam);
      else if (it.type === "player") drawPlayer(cam);
      else drawScenery(it, cam);
    }

    // 8. falling sakura petals (screen-space)
    for (const m of state.particles) {
      ctx.save();
      ctx.translate(m.x, m.y);
      ctx.rotate(m.rot);
      // squash by rotation so petals "flutter" (flat then wide)
      ctx.scale(1, 0.5 + 0.5 * Math.abs(Math.sin(m.rot)));
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = m.hue;
      ctx.beginPath();
      ctx.moveTo(0, -m.size);
      ctx.quadraticCurveTo(m.size * 0.7, -m.size * 0.3, 0, m.size);
      ctx.quadraticCurveTo(-m.size * 0.7, -m.size * 0.3, 0, -m.size);
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;

    // 9. vignette
    const vg = ctx.createRadialGradient(
      innerWidth / 2, innerHeight / 2, Math.min(innerWidth, innerHeight) * 0.35,
      innerWidth / 2, innerHeight / 2, Math.max(innerWidth, innerHeight) * 0.75);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.45)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, innerWidth, innerHeight);
  }

  // ---- Flat decals ----
  function drawFlat(f, cam) {
    const x = f.x - cam.x, y = f.y - cam.y;
    if (f.type === "pond") {
      ctx.fillStyle = "rgba(34,118,160,0.85)";
      ctx.beginPath(); ctx.ellipse(x, y, f.w / 2, f.h / 2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(125,211,252,0.5)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(x, y, f.w / 2 * (0.5 + 0.1 * Math.sin(state.t * 2 + f.x)),
        f.h / 2 * 0.5, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (f.type === "flowers") {
      for (let i = 0; i < f.n; i++) {
        const a = i * 2.4 + f.s * 6;
        const fx = x + Math.cos(a) * (8 + i * 3);
        const fy = y + Math.sin(a) * (6 + i * 2);
        ctx.fillStyle = f.c;
        ctx.beginPath(); ctx.arc(fx, fy, 3, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#fde68a";
        ctx.beginPath(); ctx.arc(fx, fy, 1.2, 0, Math.PI * 2); ctx.fill();
      }
    } else if (f.type === "rock") {
      ctx.fillStyle = "rgba(0,0,0,0.2)";
      ctx.beginPath(); ctx.ellipse(x, y + 4 * f.s, 12 * f.s, 5 * f.s, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#64748b";
      ctx.beginPath(); ctx.ellipse(x, y, 11 * f.s, 8 * f.s, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#94a3b8";
      ctx.beginPath(); ctx.ellipse(x - 2 * f.s, y - 2 * f.s, 5 * f.s, 3 * f.s, 0, 0, Math.PI * 2); ctx.fill();
    }
  }

  // ---- Billboard scenery ----
  function shadow(x, y, w, h) {
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.beginPath(); ctx.ellipse(x, y, w, h, 0, 0, Math.PI * 2); ctx.fill();
  }

  function drawScenery(b, cam) {
    const x = b.x - cam.x, y = b.y - cam.y, s = b.s || 1;
    switch (b.type) {
      case "tree": {
        shadow(x, y, 22 * s, 8 * s);
        ctx.fillStyle = "#6b3f1d";
        ctx.fillRect(x - 5 * s, y - 30 * s, 10 * s, 30 * s);
        ctx.fillStyle = "#1f7a3d";
        ctx.beginPath(); ctx.arc(x, y - 44 * s, 26 * s, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#27924a";
        ctx.beginPath(); ctx.arc(x - 12 * s, y - 38 * s, 16 * s, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(x + 13 * s, y - 40 * s, 17 * s, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.12)";
        ctx.beginPath(); ctx.arc(x + 8 * s, y - 52 * s, 9 * s, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case "pine": {
        shadow(x, y, 18 * s, 7 * s);
        ctx.fillStyle = "#5a3517";
        ctx.fillRect(x - 4 * s, y - 16 * s, 8 * s, 16 * s);
        ctx.fillStyle = "#15803d";
        for (let i = 0; i < 3; i++) {
          const ty = y - 16 * s - i * 18 * s;
          const tw = (26 - i * 6) * s;
          ctx.beginPath();
          ctx.moveTo(x, ty - 24 * s);
          ctx.lineTo(x - tw, ty);
          ctx.lineTo(x + tw, ty);
          ctx.closePath(); ctx.fill();
        }
        break;
      }
      case "bush": {
        shadow(x, y, 18 * s, 6 * s);
        ctx.fillStyle = "#2f9e4f";
        ctx.beginPath(); ctx.arc(x - 8 * s, y - 8 * s, 11 * s, 0, Math.PI * 2);
        ctx.arc(x + 8 * s, y - 8 * s, 11 * s, 0, Math.PI * 2);
        ctx.arc(x, y - 14 * s, 13 * s, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case "house": {
        const w = 70 * s, h = 50 * s;
        shadow(x, y + 2, w * 0.6, 9 * s);
        ctx.fillStyle = ["#c2703a", "#b9542f", "#9d6b8e", "#5f7da3"][(b.r * 4) | 0];
        ctx.fillRect(x - w / 2, y - h, w, h);
        // roof
        ctx.fillStyle = "#3b2b2b";
        ctx.beginPath();
        ctx.moveTo(x - w / 2 - 6 * s, y - h);
        ctx.lineTo(x, y - h - 30 * s);
        ctx.lineTo(x + w / 2 + 6 * s, y - h);
        ctx.closePath(); ctx.fill();
        // door + windows
        ctx.fillStyle = "#3b2410";
        ctx.fillRect(x - 8 * s, y - 26 * s, 16 * s, 26 * s);
        ctx.fillStyle = "#fde68a";
        ctx.fillRect(x - w / 2 + 8 * s, y - h + 10 * s, 12 * s, 12 * s);
        ctx.fillRect(x + w / 2 - 20 * s, y - h + 10 * s, 12 * s, 12 * s);
        break;
      }
      case "city": {
        const w = b.w * s, h = b.h * s;
        shadow(x, y, w * 0.55, 10);
        // body (dark night tower)
        ctx.fillStyle = b.color;
        ctx.fillRect(x - w / 2, y - h, w, h);
        ctx.fillStyle = "rgba(0,0,0,0.3)";
        ctx.fillRect(x + w / 2 - w * 0.3, y - h, w * 0.3, h);
        ctx.fillStyle = "rgba(255,255,255,0.04)";
        ctx.fillRect(x - w / 2, y - h, w * 0.16, h);
        // window grid (some lit warm/neon)
        const cols = Math.max(2, Math.floor(w / 14));
        const rows = Math.max(3, Math.floor(h / 20));
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const k = (r * 7 + c * 3 + (b.r * 100 | 0)) % 6;
            if (k === 0) { ctx.globalAlpha = 0.9; ctx.fillStyle = "#fde68a"; }
            else if (k === 1) { ctx.globalAlpha = 0.7; ctx.fillStyle = b.lit; }
            else { ctx.globalAlpha = 1; ctx.fillStyle = "rgba(255,255,255,0.05)"; }
            ctx.fillRect(x - w / 2 + 6 + c * 12, y - h + 8 + r * 16, 6, 9);
          }
        }
        ctx.globalAlpha = 1;
        // vertical neon signboard (kanji-style ticks) running down one side
        if (b.signOn) {
          const sx = x + b.signSide * (w / 2 - 5);
          const sTop = y - h + 14, sH = h * b.signLen;
          ctx.globalCompositeOperation = "lighter";
          ctx.fillStyle = b.sign;
          ctx.globalAlpha = 0.18;
          ctx.fillRect(sx - 9, sTop - 4, 18, sH + 8); // glow halo
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = "source-over";
          ctx.fillStyle = "rgba(0,0,0,0.55)";
          ctx.fillRect(sx - 7, sTop, 14, sH);
          ctx.fillStyle = b.sign;
          const chars = Math.max(2, Math.floor(sH / 16));
          for (let i = 0; i < chars; i++) {
            const cyc = 0.55 + 0.45 * Math.sin(state.t * 5 + i + b.r * 8);
            ctx.globalAlpha = cyc;
            ctx.fillRect(sx - 5, sTop + 4 + i * (sH / chars), 10, sH / chars - 6);
          }
          ctx.globalAlpha = 1;
        }
        // rooftop beacon
        ctx.fillStyle = "#f87171";
        ctx.globalAlpha = 0.5 + 0.5 * Math.sin(state.t * 4 + b.r * 9);
        ctx.beginPath(); ctx.arc(x, y - h - 3, 2.5, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        break;
      }
      case "sakura": {
        shadow(x, y, 22 * s, 8 * s);
        ctx.fillStyle = "#6b4423";
        ctx.fillRect(x - 5 * s, y - 30 * s, 10 * s, 30 * s);
        const blossom = ["#ffc0d4", "#ffb3cc", "#ffd7e6", "#ff9ec0"];
        const puffs = [[0, -44, 26], [-14, -36, 16], [15, -38, 17], [6, -52, 13], [-8, -52, 12]];
        for (let i = 0; i < puffs.length; i++) {
          ctx.fillStyle = blossom[(i + (b.r * 4 | 0)) % blossom.length];
          ctx.beginPath();
          ctx.arc(x + puffs[i][0] * s, y + puffs[i][1] * s, puffs[i][2] * s, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = "rgba(255,255,255,0.35)";
        ctx.beginPath(); ctx.arc(x + 6 * s, y - 54 * s, 7 * s, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case "lantern": {
        ctx.fillStyle = "#3a2a1a";
        ctx.fillRect(x - 2, y - 40 * s, 4, 40 * s);
        ctx.fillStyle = "#1f2937";
        ctx.fillRect(x - 10, y - 44 * s, 20, 4); // top bar
        const pulse = 0.7 + 0.3 * Math.sin(state.t * 2.5 + b.r * 6);
        ctx.globalCompositeOperation = "lighter";
        const gg = ctx.createRadialGradient(x, y - 30 * s, 0, x, y - 30 * s, 30 * pulse);
        gg.addColorStop(0, "rgba(248,113,113,0.7)");
        gg.addColorStop(1, "rgba(248,113,113,0)");
        ctx.fillStyle = gg;
        ctx.fillRect(x - 34, y - 30 * s - 34, 68, 68);
        ctx.globalCompositeOperation = "source-over";
        // paper lantern body
        ctx.fillStyle = "#dc2626";
        ctx.beginPath(); ctx.ellipse(x, y - 28 * s, 12 * s, 16 * s, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,0.25)"; ctx.lineWidth = 1.5;
        for (let i = -1; i <= 1; i++) {
          ctx.beginPath(); ctx.ellipse(x, y - 28 * s, 12 * s, 16 * s - Math.abs(i) * 5, 0, 0, Math.PI * 2);
          ctx.moveTo(x - 12 * s, y - 28 * s + i * 8); ctx.lineTo(x + 12 * s, y - 28 * s + i * 8);
        }
        ctx.beginPath(); ctx.moveTo(x - 12 * s, y - 30 * s); ctx.lineTo(x + 12 * s, y - 30 * s); ctx.stroke();
        ctx.fillStyle = "#1f2937"; ctx.fillRect(x - 4, y - 14 * s, 8, 4);
        break;
      }
      case "tokyoTower": {
        const h = 200 * s, hw = 42 * s;
        shadow(x, y, hw * 0.7, 9);
        ctx.strokeStyle = "#e53e3e"; ctx.lineWidth = 4 * s;
        // legs
        ctx.beginPath();
        ctx.moveTo(x - hw, y); ctx.lineTo(x - 6 * s, y - h);
        ctx.moveTo(x + hw, y); ctx.lineTo(x + 6 * s, y - h);
        ctx.moveTo(x - hw, y); ctx.lineTo(x + hw * 0.5, y - h * 0.55);
        ctx.moveTo(x + hw, y); ctx.lineTo(x - hw * 0.5, y - h * 0.55);
        ctx.stroke();
        // cross-bracing bands
        ctx.lineWidth = 2 * s; ctx.strokeStyle = "#fff";
        for (let i = 1; i < 6; i++) {
          const yy = y - (h * i) / 6;
          const ww = hw * (1 - i / 6.5);
          ctx.beginPath(); ctx.moveTo(x - ww, yy); ctx.lineTo(x + ww, yy); ctx.stroke();
        }
        // platform deck
        ctx.fillStyle = "#e53e3e"; ctx.fillRect(x - hw * 0.7, y - h * 0.62, hw * 1.4, 10 * s);
        // mast + beacon
        ctx.strokeStyle = "#e53e3e"; ctx.lineWidth = 4 * s;
        ctx.beginPath(); ctx.moveTo(x, y - h); ctx.lineTo(x, y - h - 26 * s); ctx.stroke();
        ctx.fillStyle = "#fde68a";
        ctx.globalAlpha = 0.5 + 0.5 * Math.sin(state.t * 4);
        ctx.beginPath(); ctx.arc(x, y - h - 28 * s, 3.5, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        break;
      }
      case "skytree": {
        const h = 240 * s;
        shadow(x, y, 16 * s, 7);
        const g2 = ctx.createLinearGradient(x, y, x, y - h);
        g2.addColorStop(0, "#7dd3fc"); g2.addColorStop(1, "#c7d2fe");
        ctx.strokeStyle = g2; ctx.lineWidth = 3 * s;
        // two tapering edges
        ctx.beginPath();
        ctx.moveTo(x - 16 * s, y); ctx.quadraticCurveTo(x - 4 * s, y - h * 0.6, x - 4 * s, y - h);
        ctx.moveTo(x + 16 * s, y); ctx.quadraticCurveTo(x + 4 * s, y - h * 0.6, x + 4 * s, y - h);
        ctx.stroke();
        // lattice rings
        ctx.lineWidth = 1.5 * s; ctx.strokeStyle = "rgba(199,210,254,0.7)";
        for (let i = 1; i < 9; i++) {
          const yy = y - (h * i) / 9;
          const ww = 16 * s * (1 - i / 10);
          ctx.beginPath(); ctx.moveTo(x - ww, yy); ctx.lineTo(x + ww, yy); ctx.stroke();
        }
        // observation bulbs
        ctx.fillStyle = "rgba(125,211,252,0.5)";
        ctx.beginPath(); ctx.ellipse(x, y - h * 0.55, 9 * s, 7 * s, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(x, y - h * 0.78, 7 * s, 5 * s, 0, 0, Math.PI * 2); ctx.fill();
        // mast beacon
        ctx.fillStyle = "#a5f3fc";
        ctx.globalAlpha = 0.5 + 0.5 * Math.sin(state.t * 3 + 1);
        ctx.beginPath(); ctx.arc(x, y - h, 3, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        break;
      }
      case "pagoda": {
        const tiers = 5, th = 22 * s;
        shadow(x, y, 30 * s, 9 * s);
        ctx.fillStyle = "#7f1d1d"; ctx.fillRect(x - 8 * s, y - th, 16 * s, th); // base body
        for (let i = 0; i < tiers; i++) {
          const ty = y - th - i * (th * 0.78);
          const ww = (34 - i * 5) * s;
          // roof
          ctx.fillStyle = "#3f2d2d";
          ctx.beginPath();
          ctx.moveTo(x - ww, ty);
          ctx.quadraticCurveTo(x - ww * 0.4, ty - 12 * s, x, ty - 13 * s);
          ctx.quadraticCurveTo(x + ww * 0.4, ty - 12 * s, x + ww, ty);
          ctx.quadraticCurveTo(x, ty - 3 * s, x - ww, ty);
          ctx.closePath(); ctx.fill();
          // wall
          ctx.fillStyle = "#9b2c2c";
          const wallW = ww * 0.5;
          ctx.fillRect(x - wallW, ty, wallW * 2, th * 0.7);
        }
        // finial
        ctx.strokeStyle = "#d4af37"; ctx.lineWidth = 2.5 * s;
        const topY = y - th - (tiers - 1) * (th * 0.78) - 13 * s;
        ctx.beginPath(); ctx.moveTo(x, topY); ctx.lineTo(x, topY - 16 * s); ctx.stroke();
        break;
      }
      case "ferris": {
        const R = 56 * s, cyW = y - R - 14 * s;
        shadow(x, y, 30 * s, 9 * s);
        // support legs
        ctx.strokeStyle = "#94a3b8"; ctx.lineWidth = 4 * s;
        ctx.beginPath();
        ctx.moveTo(x - 22 * s, y); ctx.lineTo(x, cyW);
        ctx.moveTo(x + 22 * s, y); ctx.lineTo(x, cyW);
        ctx.stroke();
        // wheel
        ctx.strokeStyle = "#cbd5e1"; ctx.lineWidth = 3 * s;
        ctx.beginPath(); ctx.arc(x, cyW, R, 0, Math.PI * 2); ctx.stroke();
        // spokes + cabins (rotating, lit)
        const spokes = 12;
        for (let i = 0; i < spokes; i++) {
          const a = state.t * 0.3 + (i * Math.PI * 2) / spokes;
          const px = x + Math.cos(a) * R, py = cyW + Math.sin(a) * R;
          ctx.strokeStyle = "rgba(203,213,225,0.6)"; ctx.lineWidth = 1.5 * s;
          ctx.beginPath(); ctx.moveTo(x, cyW); ctx.lineTo(px, py); ctx.stroke();
          ctx.fillStyle = ["#ff2d78", "#22d3ee", "#facc15", "#a855f7"][i % 4];
          ctx.beginPath(); ctx.arc(px, py, 5 * s, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = "#e2e8f0";
        ctx.beginPath(); ctx.arc(x, cyW, 5 * s, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case "torii": {
        const h = 70 * s, hw = 34 * s;
        shadow(x, y, hw * 0.8, 7 * s);
        ctx.fillStyle = "#d64545";
        ctx.fillRect(x - hw + 6 * s, y - h, 8 * s, h);
        ctx.fillRect(x + hw - 14 * s, y - h, 8 * s, h);
        ctx.fillStyle = "#7a1f1f"; ctx.fillRect(x - hw - 4 * s, y - h - 6 * s, hw * 2 + 8 * s, 7 * s);
        ctx.fillStyle = "#d64545"; ctx.fillRect(x - hw, y - h - 1 * s, hw * 2, 8 * s);
        ctx.fillStyle = "#b83535"; ctx.fillRect(x - hw + 10 * s, y - h + 16 * s, hw * 2 - 20 * s, 6 * s);
        break;
      }
      case "portal": {
        ctx.globalCompositeOperation = "lighter";
        for (let i = 0; i < 4; i++) {
          const rad = (28 + i * 10) + Math.sin(state.t * 2 + i + b.r * 6) * 4;
          ctx.globalAlpha = 0.5 - i * 0.1;
          ctx.strokeStyle = b.color;
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.ellipse(x, y - 40, rad, rad * 0.55,
            state.t * (0.6 + i * 0.2), 0, Math.PI * 2);
          ctx.stroke();
        }
        const cg = ctx.createRadialGradient(x, y - 40, 0, x, y - 40, 30);
        cg.addColorStop(0, b.color);
        cg.addColorStop(1, "rgba(0,0,0,0)");
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = cg;
        ctx.fillRect(x - 30, y - 70, 60, 60);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
        break;
      }
    }
  }

  // ---- POI objects (each kind is a distinct themed shape) ----
  function drawPoi(p, cam) {
    const bx = p.x - cam.x + p.w / 2;   // base center X (feet)
    const by = p.y - cam.y + p.h;       // base Y (ground line)
    const active = state.nearPoi === p;

    // ground shadow
    shadow(bx, by, p.w * 0.5, p.h * 0.18);

    // highlight glow when the player is near
    if (active) {
      ctx.globalCompositeOperation = "lighter";
      const gr = ctx.createRadialGradient(bx, by - p.vh * 0.4, 0, bx, by - p.vh * 0.4, p.vh * 0.9);
      gr.addColorStop(0, hexToRgba(p.color, 0.45));
      gr.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = gr;
      ctx.fillRect(bx - p.vh, by - p.vh * 1.3, p.vh * 2, p.vh * 1.6);
      ctx.globalCompositeOperation = "source-over";
    }

    const S = { torii: poiTorii, trophy: poiTrophy, gears: poiGears, shop: poiShop,
      museum: poiMuseum, tower: poiTower, briefcase: poiBriefcase, postman: poiPostman };
    (S[p.kind] || poiKiosk)(bx, by, p);

    poiNameplate(p, bx, by, active);
  }

  function poiNameplate(p, bx, by, active) {
    ctx.font = "bold 12px system-ui, sans-serif";
    const tw = ctx.measureText(p.title).width;
    const lw = tw + 30, lh = 22, lx = bx - lw / 2, ly = by + 10;
    ctx.fillStyle = active ? "rgba(15,23,42,0.95)" : "rgba(15,23,42,0.8)";
    roundRect(lx, ly, lw, lh, 8); ctx.fill();
    if (active) { ctx.strokeStyle = p.color; ctx.lineWidth = 1.5; roundRect(lx, ly, lw, lh, 8); ctx.stroke(); }
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(lx + 12, ly + lh / 2, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#e2e8f0";
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillText(p.title, lx + 20, ly + lh / 2 + 1);
    ctx.textAlign = "center";
  }

  // Welcome — a torii gateway (start point)
  function poiTorii(bx, by) {
    ctx.fillStyle = "#d64545";
    ctx.fillRect(bx - 42, by - 96, 13, 96);
    ctx.fillRect(bx + 29, by - 96, 13, 96);
    ctx.fillStyle = "#7a1f1f";
    ctx.fillRect(bx - 60, by - 104, 120, 8);
    ctx.fillStyle = "#d64545";
    ctx.fillRect(bx - 58, by - 98, 116, 13);
    ctx.fillStyle = "#b83535";
    ctx.fillRect(bx - 46, by - 76, 92, 10);
  }

  // Why Choose Us — a gold trophy
  function poiTrophy(bx, by) {
    ctx.fillStyle = "#7c5a2e"; ctx.fillRect(bx - 24, by - 16, 48, 16);
    ctx.fillStyle = "#5b4220"; ctx.fillRect(bx - 30, by - 6, 60, 6);
    ctx.fillStyle = "#d4af37"; ctx.fillRect(bx - 6, by - 40, 12, 24);
    ctx.lineWidth = 5; ctx.strokeStyle = "#d4af37";
    ctx.beginPath(); ctx.arc(bx - 26, by - 64, 10, -Math.PI / 2, Math.PI / 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(bx + 26, by - 64, 10, Math.PI / 2, -Math.PI / 2); ctx.stroke();
    ctx.fillStyle = "#e9c54a";
    ctx.beginPath();
    ctx.moveTo(bx - 26, by - 80); ctx.lineTo(bx + 26, by - 80);
    ctx.lineTo(bx + 15, by - 44); ctx.lineTo(bx - 15, by - 44); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.beginPath(); ctx.arc(bx - 8, by - 68, 4, 0, Math.PI * 2); ctx.fill();
    drawStar(bx, by - 62, 7, "#fff7cc");
  }

  // Solutions — interlocking gears
  function poiGears(bx, by) {
    gear(bx - 16, by - 44, 26, 9, state.t * 0.7, "#9ca3af");
    gear(bx + 22, by - 28, 18, 7, -state.t * 1.0 + 0.4, "#cbd5e1");
  }
  function gear(cx, cy, rad, teeth, rot, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < teeth * 2; i++) {
      const ang = rot + (i * Math.PI) / teeth;
      const rr = i % 2 === 0 ? rad : rad * 0.76;
      const px = cx + Math.cos(ang) * rr, py = cy + Math.sin(ang) * rr;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#1e293b";
    ctx.beginPath(); ctx.arc(cx, cy, rad * 0.32, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(cx, cy, rad * 0.16, 0, Math.PI * 2); ctx.fill();
  }

  // Products — a market stall with a striped awning
  function poiShop(bx, by) {
    ctx.fillStyle = "#9c6b3f"; ctx.fillRect(bx - 56, by - 42, 112, 42);
    ctx.fillStyle = "#7d5230"; ctx.fillRect(bx - 56, by - 42, 112, 7);
    // product boxes on the counter
    ctx.fillStyle = "#c084fc"; ctx.fillRect(bx - 44, by - 58, 20, 18);
    ctx.fillStyle = "#a78bfa"; ctx.fillRect(bx - 18, by - 54, 16, 14);
    ctx.fillStyle = "#8b5cf6"; ctx.fillRect(bx + 6, by - 60, 22, 20);
    // posts
    ctx.fillStyle = "#5b4226"; ctx.fillRect(bx - 58, by - 92, 6, 52); ctx.fillRect(bx + 52, by - 92, 6, 52);
    // scalloped awning
    const ax = bx - 62, w = 124;
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = i % 2 ? "#ede9fe" : "#7c3aed";
      const sx = ax + i * (w / 6);
      ctx.beginPath();
      ctx.moveTo(sx, by - 92); ctx.lineTo(sx + w / 6, by - 92);
      ctx.lineTo(sx + w / 6 - 5, by - 74); ctx.lineTo(sx + 5, by - 74);
      ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = "#6d28d9"; ctx.fillRect(bx - 62, by - 96, 124, 6);
  }

  // Track Record — a columned museum/gallery
  function poiMuseum(bx, by) {
    ctx.fillStyle = "#94a3b8"; ctx.fillRect(bx - 74, by - 10, 148, 10);
    ctx.fillStyle = "#cbd5e1"; ctx.fillRect(bx - 66, by - 66, 132, 56);
    ctx.fillStyle = "#f1f5f9";
    for (let i = 0; i < 5; i++) ctx.fillRect(bx - 56 + i * 27, by - 62, 11, 52);
    ctx.fillStyle = "#e2e8f0";
    ctx.beginPath();
    ctx.moveTo(bx - 74, by - 66); ctx.lineTo(bx, by - 94); ctx.lineTo(bx + 74, by - 66);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#94a3b8"; ctx.fillRect(bx - 74, by - 70, 148, 5);
  }

  // Company — a tall skyscraper with lit windows
  function poiTower(bx, by, p) {
    const w = p.w, h = p.vh, tx = bx - w / 2, top = by - h;
    ctx.fillStyle = "#334155"; ctx.fillRect(tx, top, w, h);
    ctx.fillStyle = "rgba(0,0,0,0.28)"; ctx.fillRect(bx + w * 0.16, top, w * 0.34, h);
    ctx.fillStyle = "rgba(255,255,255,0.06)"; ctx.fillRect(tx, top, w * 0.18, h);
    const cols = 5, rows = Math.floor((h - 20) / 18);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const lit = ((r * 5 + c * 3) % 4) === 0;
        ctx.fillStyle = lit ? "#fde68a" : "rgba(255,255,255,0.08)";
        ctx.fillRect(tx + 8 + c * ((w - 16) / cols), top + 12 + r * 18, (w - 16) / cols - 5, 11);
      }
    }
    ctx.fillStyle = "#475569"; ctx.fillRect(tx - 4, top, w + 8, 9);
    ctx.fillStyle = "#94a3b8"; ctx.fillRect(bx - 2, top - 18, 4, 18);
    ctx.fillStyle = "#f87171";
    ctx.globalAlpha = 0.5 + 0.5 * Math.sin(state.t * 4);
    ctx.beginPath(); ctx.arc(bx, top - 20, 3, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Careers — a briefcase
  function poiBriefcase(bx, by) {
    const w = 72, h = 48, top = by - h;
    ctx.lineWidth = 5; ctx.strokeStyle = "#5b3a1a";
    ctx.beginPath(); ctx.arc(bx, top + 2, 13, Math.PI, 0); ctx.stroke();
    ctx.fillStyle = "#a16207"; roundRect(bx - w / 2, top, w, h, 7); ctx.fill();
    ctx.fillStyle = "#854d0e"; ctx.fillRect(bx - w / 2, top + h / 2 - 3, w, 6);
    ctx.fillStyle = "#fbbf24"; ctx.fillRect(bx - 7, top + h / 2 - 7, 14, 10);
    ctx.fillStyle = "#78350f"; ctx.fillRect(bx - 4, top + h / 2 - 4, 8, 4);
  }

  // Contact — a mail carrier holding an envelope
  function poiPostman(bx, by) {
    ctx.fillStyle = "#1e3a8a"; ctx.fillRect(bx - 9, by - 22, 7, 22); ctx.fillRect(bx + 2, by - 22, 7, 22);
    ctx.fillStyle = "#2563eb"; roundRect(bx - 13, by - 48, 26, 28, 6); ctx.fill();
    ctx.strokeStyle = "#92400e"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(bx - 12, by - 46); ctx.lineTo(bx + 14, by - 24); ctx.stroke();
    ctx.fillStyle = "#a16207"; roundRect(bx + 6, by - 32, 18, 17, 3); ctx.fill();
    ctx.fillStyle = "#f1c27d";
    ctx.beginPath(); ctx.arc(bx, by - 56, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#1e40af";
    ctx.beginPath(); ctx.arc(bx, by - 58, 9, Math.PI, 0); ctx.fill();
    ctx.fillRect(bx - 12, by - 58, 7, 3);
    // envelope, gently bobbing
    const ey = by - 38 + Math.sin(state.t * 3) * 2;
    ctx.fillStyle = "#fff"; ctx.fillRect(bx - 34, ey - 8, 20, 14);
    ctx.strokeStyle = "#94a3b8"; ctx.lineWidth = 1; ctx.strokeRect(bx - 34, ey - 8, 20, 14);
    ctx.beginPath(); ctx.moveTo(bx - 34, ey - 8); ctx.lineTo(bx - 24, ey - 1); ctx.lineTo(bx - 14, ey - 8); ctx.stroke();
  }

  // fallback — an info kiosk
  function poiKiosk(bx, by, p) {
    ctx.fillStyle = "#475569"; ctx.fillRect(bx - 3, by - 40, 6, 40);
    ctx.fillStyle = p.color; roundRect(bx - 26, by - 78, 52, 40, 8); ctx.fill();
    ctx.fillStyle = "#0f172a"; ctx.font = "26px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(p.icon || "i", bx, by - 57);
  }

  function drawStar(cx, cy, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const ang = (i * Math.PI) / 5 - Math.PI / 2;
      const rr = i % 2 === 0 ? r : r * 0.45;
      const px = cx + Math.cos(ang) * rr, py = cy + Math.sin(ang) * rr;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath(); ctx.fill();
  }

  function drawPlayer(cam) {
    const p = state.player;
    const x = p.x - cam.x, y = p.y - cam.y;
    const moving = state.keys.size > 0 || !!state.moveTarget;
    const bob = Math.sin(state.t * 12) * (moving ? 2.5 : 0);

    // shadow
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath();
    ctx.ellipse(x, y + p.r, p.r * 0.9, p.r * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();

    // body
    ctx.fillStyle = "#fef08a";
    ctx.beginPath();
    ctx.arc(x, y + bob, p.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#ca8a04";
    ctx.stroke();

    // eyes (face direction)
    ctx.fillStyle = "#1f2937";
    const ex = p.face * 5;
    ctx.beginPath(); ctx.arc(x + ex - 3, y - 3 + bob, 2.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + ex + 3, y - 3 + bob, 2.2, 0, Math.PI * 2); ctx.fill();
  }

  function roundRect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---- Minimap ----
  function drawMini() {
    const W = mini.clientWidth, H = mini.clientHeight;
    mctx.clearRect(0, 0, W, H);
    const sx = W / state.world.w, sy = H / state.world.h;
    mctx.fillStyle = "rgba(22,101,52,0.6)";
    mctx.fillRect(0, 0, W, H);
    for (const poi of state.pois) {
      mctx.fillStyle = poi.color;
      mctx.fillRect(poi.x * sx, poi.y * sy, Math.max(3, poi.w * sx), Math.max(3, poi.h * sy));
    }
    // player
    mctx.fillStyle = "#fde047";
    mctx.beginPath();
    mctx.arc(state.player.x * sx, state.player.y * sy, 3, 0, Math.PI * 2);
    mctx.fill();
    // viewport box
    mctx.strokeStyle = "rgba(255,255,255,0.6)";
    mctx.lineWidth = 1;
    mctx.strokeRect(state.camera.x * sx, state.camera.y * sy, innerWidth * sx, innerHeight * sy);
  }

  // ---- Main loop ----
  let last = 0;
  function loop(ts) {
    const dt = Math.min(0.05, (ts - last) / 1000 || 0);
    last = ts;
    state.t += dt;
    if (state.running && !state.panelOpen) update(dt);
    if (state.running) updateParticles(dt);
    draw();
    drawMini();
    requestAnimationFrame(loop);
  }

  // ---- Panel (info reader) ----
  let panelPoi = null, panelPage = 0;
  const panelEl = document.getElementById("panel");
  function openPanel(poi) {
    panelPoi = poi; panelPage = 0;
    state.panelOpen = true;
    state.keys.clear();
    state.moveTarget = null;
    Sound.confirm();
    document.getElementById("panel-icon").textContent = poi.icon || "?";
    document.getElementById("panel-icon").style.background = hexToRgba(poi.color, 0.25);
    document.getElementById("panel-title").textContent = poi.title;
    renderPage();
    panelEl.classList.remove("hidden");
  }
  function renderPage() {
    const pages = panelPoi.pages || [];
    document.getElementById("panel-body").textContent = pages[panelPage] || "";
    document.getElementById("panel-progress").textContent =
      `${panelPage + 1} / ${pages.length}`;
    document.getElementById("panel-prev").disabled = panelPage === 0;
    const nextBtn = document.getElementById("panel-next");
    nextBtn.textContent = panelPage >= pages.length - 1 ? "Done ✓" : "Next ›";
  }
  function panelStep(dir) {
    const pages = panelPoi.pages || [];
    if (dir > 0 && panelPage >= pages.length - 1) { closePanel(); return; }
    panelPage = clamp(panelPage + dir, 0, pages.length - 1);
    renderPage();
  }
  function closePanel() {
    state.panelOpen = false;
    panelEl.classList.add("hidden");
  }
  document.getElementById("panel-prev").onclick = () => panelStep(-1);
  document.getElementById("panel-next").onclick = () => panelStep(1);
  document.getElementById("panel-close").onclick = closePanel;

  function hexToRgba(hex, a) {
    const h = hex.replace("#", "");
    const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  // ---- Start ----
  document.getElementById("start-btn").onclick = () => {
    document.getElementById("start").classList.add("hidden");
    state.running = true;
    Sound.init();
    Sound.resume();
    Sound.confirm();
  };

  // mute toggle (M key or HUD button)
  function toggleMute() {
    Sound.setOn(!Sound.on);
    const btn = document.getElementById("mute");
    if (btn) btn.textContent = Sound.on ? "🔊" : "🔇";
  }
  const muteBtn = document.getElementById("mute");
  if (muteBtn) muteBtn.onclick = toggleMute;

  // ---- Service worker (PWA) ----
  if ("serviceWorker" in navigator) {
    addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }
})();
