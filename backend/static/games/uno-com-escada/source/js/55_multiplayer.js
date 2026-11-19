// ============================================================================
// ÇOK OYUNCULU + DOKUNMATİK KUMANDA — Uno Merdivenli
// ----------------------------------------------------------------------------
//   1) İkinci oyuncunun (Murat / Selin) aracını aynı dünyada ayrı slotlarla
//      ve CAR.atlasBG bağlı bir drawable ile akıcı şekilde çizer.
//   2) Konumu 30 Hz + hız/açısal hız vektörüyle gönderir, her karede
//      dead-reckoning + üstel yakınsama ile pürüzsüz hareket ettirir.
//   3) Araçlar arası 2B fiziksel çarpışma (itki, savrulma, duman, ses ve
//      karşı tarafa game_hit iletimi) sağlar.
//   4) 3B konumsal motor/korna/çarpışma sesi, araç üstü etiket (#mpTag),
//      canlı sıra/mesafe HUD'u (#mpHud), korna (G / 📣) ve yanına ışınlanma
//      (T / ⚡) özelliklerini yönetir.
// ============================================================================

const GAME_ID = 'uno-com-escada';
const GAME_NAMES = { murat: 'Murat', selin: 'Selin' };
const MP_PAINT = [0.78, 0.14, 0.36]; // Partnerin Uno rengi (böğürtlen pembesi)
const MP_TICK_HZ = 30;
const BRIDGE_TAG = '__ahududu';
const CAR_SPHERE_OFFSETS = [-0.90, 0.10, 1.10];
const CAR_SPHERE_R = 0.80;

const MPSHARE = (() => {
  try {
    const handlers = new Set();
    const watchers = new Set();
    const pending = {};
    let seq = 0;

    const getDirect = () => window.__ahududuGameBus || null;
    const emit = open => {
      share.ready = !!open;
      watchers.forEach(fn => { try { fn(!!open); } catch (e) {} });
    };
    const post = m => {
      try {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage(Object.assign({ [BRIDGE_TAG]: 1 }, m), '*');
        }
      } catch (e) {}
    };

    const share = {
      ready: false,
      present() { return !!(getDirect() || this.ready); },
      open() {
        const d = getDirect();
        if (d) { try { return !!d.open(); } catch (e) {} }
        return !!this.ready;
      },
      send(o) {
        const d = getDirect();
        if (d) { try { return !!d.send(o); } catch (e) {} }
        post({ kind: 'send', payload: o });
        return !!this.ready;
      },
      on(fn) { if (typeof fn === 'function') handlers.add(fn); },
      onState(fn) { if (typeof fn === 'function') watchers.add(fn); },
      fullscreen() {
        const d = getDirect();
        if (d && typeof d.requestFullscreen === 'function') { try { d.requestFullscreen(); return; } catch (e) {} }
        post({ kind: 'fullscreen' });
      },
      probe() {
        return new Promise(resolve => {
          if (getDirect()) { resolve(true); return; }
          const id = ++seq;
          pending[id] = () => resolve(true);
          post({ kind: 'ping' });
          post({ kind: 'state?', id });
          setTimeout(() => {
            if (pending[id]) { delete pending[id]; resolve(false); }
          }, 1200);
        });
      }
    };

    addEventListener('message', ev => {
      const d = ev.data;
      if (!d || d[BRIDGE_TAG] !== 1) return;
      if (d.kind === 'recv' && d.payload) {
        handlers.forEach(fn => { try { fn(d.payload); } catch (e) {} });
      } else if (d.kind === 'state') {
        if (d.id >= 0 && pending[d.id]) {
          const fn = pending[d.id];
          delete pending[d.id];
          fn(!!d.open);
        } else if (d.id === -1) {
          emit(d.open);
        }
      } else if (d.kind === 'ready') {
        emit(true);
      }
    });

    post({ kind: 'hello' });
    return share;
  } catch (e) {
    return null;
  }
})();

const NET = {
  ws: null,
  opened: false,
  closedByUser: false,
  offlineTries: 0,
  _probed: false,
  get live() { return this.opened || (MPSHARE ? MPSHARE.open() : false); },
  json(o) {
    if (MPSHARE && MPSHARE.open()) {
      if (MPSHARE.send(o) !== false) return;
    }
    try {
      if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o));
    } catch (e) {}
  },
  connect() {
    if (typeof location === 'undefined' || !/^https?:$/.test(location.protocol)) return;
    if (MPSHARE && MPSHARE.open()) {
      this.opened = false;
      MP.retryAt = 0;
      mpUiRefresh();
      return;
    }
    if (MPSHARE && !this._probed) {
      this._probed = true;
      MPSHARE.probe().then(ok => {
        if (ok) {
          MP.retryAt = 0;
          NET.opened = false;
          mpAnnounce();
          mpUiRefresh();
        } else {
          NET._openOwn();
        }
      });
      return;
    }
    this._openOwn();
  },
  _openOwn() {
    this.close();
    this.closedByUser = false;
    let host = location.host;
    let proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    try {
      const q = new URLSearchParams(location.search);
      const wsOverride = q.get('wsserver');
      const wsPort = q.get('wsport');
      if (wsOverride) {
        host = wsOverride;
        proto = /^https/.test(location.protocol) ? 'wss://' : 'ws://';
      } else if (wsPort) {
        host = location.hostname + ':' + wsPort;
        proto = 'ws://';
      }
    } catch (e) {}
    if (!host) { MP.retryAt = performance.now() + 4000; return; }
    if (location.hostname === 'localhost' && location.port !== '33470' && location.port !== '5173') {
      let server = 'https://ahududu.fakeyol.com';
      try { server = localStorage.getItem('ahududu_server_url') || server; } catch (e) {}
      host = server.replace(/^https?:\/\//, '').replace(/\/+$/, '');
      proto = server.indexOf('https') === 0 ? 'wss://' : 'ws://';
    }
    const url = proto + host + '/ws/' + MP.userId;
    let ws;
    try { ws = new WebSocket(url); } catch (e) { MP.retryAt = performance.now() + 4000; return; }
    this.ws = ws;
    ws.onopen = () => {
      NET.opened = true;
      NET.offlineTries = 0;
      MP.retryAt = 0;
      mpAnnounce();
      mpUiRefresh();
    };
    ws.onmessage = ev => {
      let d;
      try { d = JSON.parse(ev.data); } catch (e) { return; }
      mpOnPacket(d);
    };
    ws.onclose = () => {
      const was = NET.ws === ws;
      NET.opened = false;
      if (was) NET.ws = null;
      if (NET.closedByUser) return;
      NET.offlineTries++;
      MP.retryAt = performance.now() + (NET.offlineTries > 6 ? 15000 : 2500);
    };
    ws.onerror = () => {};
  },
  close() {
    this.closedByUser = true;
    if (this.ws) {
      try { this.ws.close(); } catch (e) {}
      this.ws = null;
    }
    this.opened = false;
  }
};

const MP = {
  userId: 'murat',
  partnerId: 'selin',
  myName: 'Murat',
  partnerName: 'Selin',
  partnerOn: false,
  retryAt: 0,
  lastRxCarAt: 0,
  lastRxHelloAt: 0,
  helloAt: 0,
  lastAnnounceAt: 0,
  lastHitTxAt: 0,
  lastCrashAt: 0,
  lastHornAt: 0,
  noticeText: '',
  noticeUntil: 0,
  T: { x: 0, y: 0, z: 0, yaw: 0, spd: 0, gear: 1, acc: 0, steer: 0, s: 0, d: 0, vx: 0, vz: 0, wy: 0, laps: 0, best: 0 },
  S: { x: 0, y: 0, z: 0, yaw: 0, spd: 0, gear: 1, acc: 0, steer: 0, spin: 0 },
  hasT: false,
  carReady: false,
  shown: false,
  seqRank: 0,
  set: null,
  drawable: null,
  glass: null,
  bodyObj: 0,
  wheelObj: [0, 0, 0, 0],
  steerObj: 0,
  paint: MP_PAINT,
  _t: m4(),
  _t2: m4(),
  _g: m4(),
  _b: m4()
};

function mpResolveUser() {
  let id = '';
  try {
    const m = (location.search || '').toLowerCase().match(/[?&]u=(murat|selin)/);
    if (m) id = m[1];
    if (!id) {
      const raw = (localStorage.getItem('ahududu_user') || '').toLowerCase();
      if (raw === 'murat' || raw === 'selin') id = raw;
    }
  } catch (e) {}
  mpSetUser(id || 'murat');
}

function mpSetUser(id) {
  if (!GAME_NAMES[id]) return;
  MP.userId = id;
  MP.partnerId = id === 'murat' ? 'selin' : 'murat';
  MP.myName = GAME_NAMES[MP.userId];
  MP.partnerName = GAME_NAMES[MP.partnerId];
  MP.seqRank = MP.userId === 'murat' ? 0 : 1;
}

function mpNotice(txt, ms) {
  MP.noticeText = txt || '';
  MP.noticeUntil = performance.now() + (ms || 2400);
  mpUiRefresh();
}

function mpFmtLap(sec) {
  if (!(sec > 0 && sec < 600)) return '';
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2);
}

// ------------------------ 3B KONUMSAL SES + KORNA + ÇARPIŞMA ---------------
const MPSND = { ready: false, ctx: null, gain: null, panner: null, osc: null, osc2: null, filter: null, lastAt: 0 };

function mpSoundInit() {
  if (MPSND.ready) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const gain = ctx.createGain();
    gain.gain.value = 0;
    let head = gain;
    let panner = null;
    if (ctx.createStereoPanner) {
      panner = ctx.createStereoPanner();
      gain.connect(panner);
      head = panner;
    }
    head.connect(ctx.destination);
    const o1 = ctx.createOscillator();
    o1.type = 'sawtooth';
    const o2 = ctx.createOscillator();
    o2.type = 'triangle';
    const g2 = ctx.createGain();
    g2.gain.value = 0.25;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 820;
    o1.connect(lp);
    o2.connect(g2);
    g2.connect(lp);
    lp.connect(gain);
    o1.start();
    o2.start();
    MPSND.ctx = ctx;
    MPSND.gain = gain;
    MPSND.osc = o1;
    MPSND.osc2 = o2;
    MPSND.filter = lp;
    MPSND.panner = panner;
    MPSND.ready = true;
  } catch (e) {}
}

function mpUnlockAudio() {
  try { mpSoundInit(); } catch (e) {}
  try { if (MPSND.ctx && MPSND.ctx.state === 'suspended') MPSND.ctx.resume().catch(() => {}); } catch (e) {}
  try { if (typeof SND !== 'undefined' && SND.ctx && SND.ctx.state === 'suspended') SND.ctx.resume().catch(() => {}); } catch (e) {}
}

function mpSoundFrame() {
  const C = MPSND.ctx;
  if (!C) return;
  const now = performance.now();
  if (now - MPSND.lastAt < 80) return;
  MPSND.lastAt = now;
  const muted = (typeof SND !== 'undefined' && SND.mute) || (typeof UI !== 'undefined' && typeof ST !== 'undefined' && UI.st !== ST.JOGO && UI.st !== ST.FITA);
  if (muted || !MP.hasT || !MP.partnerOn || typeof GS === 'undefined') {
    try { MPSND.gain.gain.setTargetAtTime(0, C.currentTime, 0.08); } catch (e) {}
    return;
  }
  const S = MP.S;
  const dx = S.x - GS.cx, dz = S.z - GS.cz, dy = S.y - GS.cy;
  const dist = Math.hypot(dx, dy, dz);
  const vol = dist > 75 ? 0 : Math.pow(1 - dist / 75, 2) * 0.22;
  const t = C.currentTime;
  const sp = Math.abs(S.spd || 0);
  try {
    MPSND.gain.gain.setTargetAtTime(vol, t, 0.1);
    const rpm = 850 + Math.min(sp, 48) * 165;
    MPSND.osc.frequency.setTargetAtTime(rpm / 30, t, 0.08);
    MPSND.osc2.frequency.setTargetAtTime(rpm / 60, t, 0.08);
    MPSND.filter.frequency.setTargetAtTime(380 + Math.min(sp, 48) * 65, t, 0.1);
    if (MPSND.panner && MPSND.panner.pan) {
      const c = Math.cos(GS.yaw), s = Math.sin(GS.yaw);
      const rx = -s * dx + c * dz;
      MPSND.panner.pan.value = clamp(rx / 20, -1, 1);
    }
  } catch (e) {}
}

function mpPlayHornSound(remote) {
  mpUnlockAudio();
  const C = MPSND.ctx;
  if (!C || C.state !== 'running') return;
  if (typeof SND !== 'undefined' && SND.mute) return;
  try {
    const t = C.currentTime;
    const g = C.createGain();
    let vol = 0.22;
    let panVal = 0;
    if (remote && MP.hasT && typeof GS !== 'undefined') {
      const dx = MP.S.x - GS.cx, dz = MP.S.z - GS.cz;
      const dist = Math.hypot(dx, dz);
      vol = dist > 110 ? 0.02 : (1 - dist / 110) * 0.24;
      const c = Math.cos(GS.yaw), s = Math.sin(GS.yaw);
      panVal = clamp((-s * dx + c * dz) / 22, -1, 1);
    }
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.02);
    g.gain.setValueAtTime(vol, t + 0.20);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    const lp = C.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800;
    let head = g;
    if (C.createStereoPanner) {
      const p = C.createStereoPanner();
      p.pan.value = panVal;
      g.connect(p);
      head = p;
    }
    head.connect(C.destination);
    for (const freq of [405, 510]) {
      const o = C.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(freq, t);
      o.connect(lp);
      o.start(t);
      o.stop(t + 0.29);
    }
    lp.connect(g);
  } catch (e) {}
}

function mpPlayCrashSound(intensity) {
  mpUnlockAudio();
  const C = MPSND.ctx;
  if (!C || C.state !== 'running') return;
  if (typeof SND !== 'undefined' && SND.mute) return;
  try {
    const t = C.currentTime;
    const k = clamp((intensity || 4) / 14, 0.25, 1);
    const g = C.createGain();
    g.gain.setValueAtTime(0.32 * k, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    g.connect(C.destination);
    const o = C.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(140 * k + 55, t);
    o.frequency.exponentialRampToValueAtTime(34, t + 0.2);
    o.connect(g);
    o.start(t);
    o.stop(t + 0.23);
  } catch (e) {}
}

// ------------------------ PARTNER ARACI ------------------------------------
function mpBuildPartnerCar() {
  if (MP.carReady) return true;
  try {
    if (typeof R === 'undefined' || typeof CAR === 'undefined' || !CAR.shared || typeof objSlot !== 'function') return false;
    const sh = CAR.shared;
    if (!sh.body || !sh.wheel) return false;
    const fam = CAR.fam;
    if (!fam) return false;

    MP.bodyObj = objSlot();
    for (let i = 0; i < 4; i++) MP.wheelObj[i] = objSlot();
    MP.steerObj = objSlot();

    const set = MP.set = new MeshSet(fam);
    set.add(sh.body, MP.bodyObj, 3);
    for (let i = 0; i < 4; i++) {
      set.add(sh.wheel, MP.wheelObj[i], 3);
      if (sh.wheelBlur) set.add(sh.wheelBlur, MP.wheelObj[i], 1);
    }
    if (sh.steer) set.add(sh.steer, MP.steerObj, 3);

    // Kendi arabamızdaki (30_car_d_main.js) drawable ile BİREBİR aynı kural:
    // Grupta 3 numaralı bind group olarak CAR.atlasBG bağlanmalıdır, aksi halde
    // WebGPU komut tamponunu geçersiz kılar ve ekran simsiyah kalır.
    MP.drawable = {
      draw(pass, ctx) {
        if (ctx.kind === KIND.SHADOW && ctx.cascade === 3) return;
        if (!CAR.atlasBG) return;
        pass.setBindGroup(3, CAR.atlasBG);
        set.draw(pass, ctx);
      }
    };

    if (sh.glass) {
      const gl = new GlassSet();
      gl.add_(sh.glass, MP.bodyObj);
      MP.glass = gl;
    }

    MP.carReady = true;
    return true;
  } catch (e) {
    console.warn('[uno-mp] partner aracı kurulamadı:', e);
    return false;
  }
}

function mpShowPartner(on) {
  try {
    if (!MP.carReady && !mpBuildPartnerCar()) return;
    const add = !!on;
    if (add) {
      if (R.drawables.indexOf(MP.drawable) < 0) R.drawables.push(MP.drawable);
      if (MP.glass && R.transparents.indexOf(MP.glass) < 0) R.transparents.push(MP.glass);
    } else {
      let i;
      while ((i = R.drawables.indexOf(MP.drawable)) >= 0) R.drawables.splice(i, 1);
      if (MP.glass) {
        let j;
        while ((j = R.transparents.indexOf(MP.glass)) >= 0) R.transparents.splice(j, 1);
      }
    }
    MP.shown = add;
  } catch (e) {}
}

function mpPlacePartner(snap) {
  if (!MP.carReady || !MP.hasT) return;
  const S = MP.S, T = MP.T;
  const dt = (typeof RT !== 'undefined' && RT[1] > 0 && RT[1] < 0.1) ? RT[1] : (1 / 60);
  if (!snap) {
    const now = performance.now();
    const age = Math.min(Math.max(0, (now - MP.lastRxCarAt) / 1000), 0.25);

    const predYaw = T.yaw + (T.wy || 0) * age;
    const predX = T.x + (T.vx || (Math.cos(predYaw) * T.spd)) * age;
    const predZ = T.z + (T.vz || (Math.sin(predYaw) * T.spd)) * age;

    S.x += (T.vx || (Math.cos(S.yaw) * S.spd)) * dt;
    S.z += (T.vz || (Math.sin(S.yaw) * S.spd)) * dt;
    S.yaw += (T.wy || 0) * dt;

    const kPos = 1 - Math.exp(-dt * 16);
    const kYaw = 1 - Math.exp(-dt * 18);
    S.x += (predX - S.x) * kPos;
    S.y += (T.y - S.y) * kPos;
    S.z += (predZ - S.z) * kPos;
    let dy = predYaw - S.yaw;
    while (dy > PI) dy -= TAU;
    while (dy < -PI) dy += TAU;
    S.yaw += dy * kYaw;
    S.spd += (T.spd - S.spd) * kPos;
    S.steer += ((T.steer || 0) - S.steer) * kPos;
    S.gear = T.gear;
    S.acc = T.acc;
    S.spin = (S.spin + (S.spd / VP.R) * dt) % TAU;
  } else {
    S.gear = T.gear;
    S.acc = T.acc;
  }

  const c = Math.cos(S.yaw), s = Math.sin(S.yaw), ox = -(VP.L / 2 - VP.a);
  const G0 = MP._g, B = MP._b, t = MP._t, t2 = MP._t2;
  G0[0] = c; G0[1] = 0; G0[2] = s; G0[3] = 0;
  G0[4] = 0; G0[5] = 1; G0[6] = 0; G0[7] = 0;
  G0[8] = -s; G0[9] = 0; G0[10] = c; G0[11] = 0;
  G0[12] = S.x + c * ox; G0[13] = S.y; G0[14] = S.z + s * ox; G0[15] = 1;

  B.set(G0);

  objPrev(MP.bodyObj).set(objModel(MP.bodyObj));
  objModel(MP.bodyObj).set(B);

  const P = objParams(MP.bodyObj);
  P[0] = S.acc < -0.05 ? 1 : 0;
  P[1] = S.gear === 0 ? 1 : 0;
  P[2] = 1;
  P[4] = MP.paint[0];
  P[5] = MP.paint[1];
  P[6] = MP.paint[2];
  P[7] = 0;

  const blur = Math.abs(S.spd / VP.R);
  for (let i = 0; i < 4; i++) {
    const sw = MP.wheelObj[i], h = CAR.hubs[i], left = (i & 1) === 0;
    objPrev(sw).set(objModel(sw));
    const a = -(i < 2 ? S.steer : 0) + (left ? PI : 0), ca = Math.cos(a), sa = Math.sin(a);
    const g = left ? S.spin : -S.spin, cg = Math.cos(g), sg = Math.sin(g);
    t[0] = ca * cg; t[1] = sg; t[2] = -sa * cg; t[3] = 0;
    t[4] = -ca * sg; t[5] = cg; t[6] = sa * sg; t[7] = 0;
    t[8] = sa; t[9] = 0; t[10] = ca; t[11] = 0;
    t[12] = h[0]; t[13] = h[1]; t[14] = h[2]; t[15] = 1;
    m4mul(objModel(sw), B, t);
    objParams(sw)[0] = blur;
  }

  objPrev(MP.steerObj).set(objModel(MP.steerObj));
  const swa = S.steer * 14, ca = Math.cos(-swa), sa = Math.sin(-swa);
  t2.fill(0); t2[0] = 1; t2[5] = ca; t2[6] = sa; t2[9] = -sa; t2[10] = ca; t2[15] = 1;
  m4mul(t, CAR.steerMat, t2);
  m4mul(objModel(MP.steerObj), B, t);
}

// ------------------------ ARAÇLAR ARASI ÇARPIŞMA ---------------------------
function mpCollideCar() {
  if (!MP.partnerOn || !MP.hasT || !MP.shown || typeof VEH === 'undefined') return;
  if (typeof GAME !== 'undefined' && !GAME.ready) return;
  if (typeof GS !== 'undefined' && GS.frozen) return;
  const V = VEH, S = MP.S, T = MP.T;
  if (Math.abs(V.y - S.y) > 2.2) return;
  const bdx = V.x - S.x, bdz = V.z - S.z;
  if (bdx * bdx + bdz * bdz > 25) return;

  const c1 = Math.cos(V.yaw), s1 = Math.sin(V.yaw);
  const c2 = Math.cos(S.yaw), s2 = Math.sin(S.yaw);
  const minDist = CAR_SPHERE_R * 2;
  const minDist2 = minDist * minDist;

  let bestPen = 0, bestNx = 0, bestNz = 0, bestRx = 0, bestRz = 0;
  for (let i = 0; i < 3; i++) {
    const o1 = CAR_SPHERE_OFFSETS[i];
    const x1 = V.x + c1 * o1, z1 = V.z + s1 * o1;
    for (let j = 0; j < 3; j++) {
      const o2 = CAR_SPHERE_OFFSETS[j];
      const x2 = S.x + c2 * o2, z2 = S.z + s2 * o2;
      const dx = x1 - x2, dz = z1 - z2;
      const d2 = dx * dx + dz * dz;
      if (d2 >= minDist2) continue;
      const dist = Math.sqrt(d2);
      const pen = minDist - dist;
      if (pen > bestPen) {
        bestPen = pen;
        if (dist > 1e-4) { bestNx = dx / dist; bestNz = dz / dist; }
        else { bestNx = -s1; bestNz = c1; }
        bestRx = c1 * o1;
        bestRz = s1 * o1;
      }
    }
  }
  if (bestPen <= 0) return;

  const pen = Math.min(bestPen, 1.5);
  V.x += bestNx * pen * 0.65;
  V.z += bestNz * pen * 0.65;
  S.x -= bestNx * pen * 0.35;
  S.z -= bestNz * pen * 0.35;
  T.x -= bestNx * pen * 0.35;
  T.z -= bestNz * pen * 0.35;

  let wvx = V.vx * c1 - V.vy * s1, wvz = V.vx * s1 + V.vy * c1;
  const pvx = (T.vx !== undefined && MP.lastRxCarAt > 0) ? T.vx : Math.cos(S.yaw) * S.spd;
  const pvz = (T.vz !== undefined && MP.lastRxCarAt > 0) ? T.vz : Math.sin(S.yaw) * S.spd;

  const cvx = wvx - V.r * bestRz, cvz = wvz + V.r * bestRx;
  const vn = (cvx - pvx) * bestNx + (cvz - pvz) * bestNz;

  if (vn < 0) {
    const rawImp = -1.45 * vn * 0.6;
    const imp = clamp(Math.max(rawImp, -vn > 0.5 ? 1.8 : 0), 0, 24);
    wvx += bestNx * imp;
    wvz += bestNz * imp;

    const tgx = -bestNz, tgz = bestNx;
    const vt = (wvx - pvx) * tgx + (wvz - pvz) * tgz;
    wvx -= tgx * vt * 0.14;
    wvz -= tgz * vt * 0.14;

    V.vx = wvx * c1 + wvz * s1;
    V.vy = -wvx * s1 + wvz * c1;
    V.r = clamp(V.r + clamp((bestRx * bestNz - bestRz * bestNx) * imp * 0.32, -3.5, 3.5), -6, 6) * 0.88;
    V.rollV += clamp((-s1 * bestNx + c1 * bestNz) * imp * 0.45, -1.8, 1.8);
    V.pitchV += clamp(-(c1 * bestNx + s1 * bestNz) * imp * 0.3, -1.4, 1.4);
    for (let w = 0; w < 4; w++) V.slip[w] = Math.max(V.slip[w], Math.min(1, imp * 0.12));
    V.hits++;

    const now = performance.now();
    MP.lastCrashAt = now;
    if (imp > 1.2) mpPlayCrashSound(imp);
    if (NET.live && imp > 1.0 && now - MP.lastHitTxAt > 120) {
      MP.lastHitTxAt = now;
      NET.json({
        type: 'game_hit',
        from: MP.userId,
        ix: Math.round(-bestNx * imp * 100) / 100,
        iz: Math.round(-bestNz * imp * 100) / 100,
        tr: Math.round((bestRx * bestNz - bestRz * bestNx) * imp * 20) / 100
      });
    }
  }
}

function mpOnHit(d) {
  if (!d || typeof VEH === 'undefined') return;
  if (typeof GS !== 'undefined' && GS.frozen) return;
  const now = performance.now();
  // Kendi tarafımızda az önce çarpışma fizik olarak işlendiyse çift darbe uygulama
  if (now - MP.lastCrashAt < 180) return;
  MP.lastCrashAt = now;

  const ix = clamp(+d.ix || 0, -24, 24);
  const iz = clamp(+d.iz || 0, -24, 24);
  const V = VEH, c = Math.cos(V.yaw), s = Math.sin(V.yaw);
  let wvx = V.vx * c - V.vy * s + ix;
  let wvz = V.vx * s + V.vy * c + iz;
  V.vx = wvx * c + wvz * s;
  V.vy = -wvx * s + wvz * c;
  V.r = clamp(V.r + clamp(+d.tr || 0, -2.5, 2.5), -6, 6);
  V.rollV += clamp((-s * ix + c * iz) * 0.35, -1.5, 1.5);
  V.pitchV += clamp(-(c * ix + s * iz) * 0.25, -1.2, 1.2);
  for (let w = 0; w < 4; w++) V.slip[w] = Math.max(V.slip[w], 0.55);
  V.hits++;
  mpPlayCrashSound(Math.hypot(ix, iz));
}

// ------------------------ AĞ PAKETLERİ -------------------------------------
function mpSelfState() {
  const V = VEH;
  const c = Math.cos(V.yaw), s = Math.sin(V.yaw);
  const wvx = (V.vx || 0) * c - (V.vy || 0) * s;
  const wvz = (V.vx || 0) * s + (V.vy || 0) * c;
  const best = (typeof LAP !== 'undefined' && LAP[2] > 0) ? LAP[2] : 0;
  return [
    Math.round(V.x * 100) / 100,
    Math.round(V.y * 100) / 100,
    Math.round(V.z * 100) / 100,
    Math.round(V.yaw * 1000) / 1000,
    Math.round(Math.sqrt(V.vx * V.vx + V.vy * V.vy) * 100) / 100,
    V.gear | 0,
    (V.ctl && V.ctl[1] > 0.1) ? -1 : 1,
    Math.round((V.s || 0) * 10) / 10,
    Math.round((V.d || 0) * 10) / 10,
    Math.round((V.steer || 0) * 1000) / 1000,
    Math.round(wvx * 100) / 100,
    Math.round(wvz * 100) / 100,
    Math.round((V.r || 0) * 1000) / 1000,
    V.laps | 0,
    Math.round(best * 100) / 100
  ];
}

let _mpLastSendAt = 0;
function mpSendCar() {
  if (!NET.live || typeof VEH === 'undefined') return;
  const now = performance.now();
  if (now - _mpLastSendAt < (1000 / MP_TICK_HZ)) return;
  _mpLastSendAt = now;
  NET.json({ type: 'game_car', from: MP.userId, d: mpSelfState() });
}

function mpOnCar(d) {
  if (!Array.isArray(d) || d.length < 5) return;
  const T = MP.T;
  const nx = +d[0] || 0, ny = +d[1] || 0, nz = +d[2] || 0, nyaw = +d[3] || 0, nspd = +d[4] || 0;
  const now = performance.now();
  const dtRx = (MP.lastRxCarAt > 0) ? Math.min(Math.max((now - MP.lastRxCarAt) / 1000, 0.015), 0.25) : 0;
  const jump = !MP.hasT || Math.abs(T.x - nx) + Math.abs(T.z - nz) > 30;
  if (d.length >= 13) {
    T.vx = +d[10] || 0;
    T.vz = +d[11] || 0;
    T.wy = +d[12] || 0;
  } else if (dtRx > 0 && !jump) {
    T.vx = (nx - T.x) / dtRx;
    T.vz = (nz - T.z) / dtRx;
    let dy = nyaw - T.yaw; if (dy > PI) dy -= TAU; else if (dy < -PI) dy += TAU;
    T.wy = dy / dtRx;
  } else {
    T.vx = Math.cos(nyaw) * nspd;
    T.vz = Math.sin(nyaw) * nspd;
    T.wy = 0;
  }
  T.x = nx;
  T.y = ny;
  T.z = nz;
  T.yaw = nyaw;
  T.spd = nspd;
  T.gear = +d[5] || 0;
  T.acc = +d[6] || 0;
  T.s = +d[7] || 0;
  T.d = +d[8] || 0;
  T.steer = +d[9] || 0;
  if (d.length >= 15) {
    T.laps = +d[13] || 0;
    T.best = +d[14] || 0;
  }
  MP.lastRxCarAt = now;
  if (jump) {
    MP.S.x = T.x; MP.S.y = T.y; MP.S.z = T.z; MP.S.yaw = T.yaw; MP.S.spd = T.spd; MP.S.steer = T.steer;
    MP.hasT = true;
  }
  if (!MP.partnerOn || !MP.shown) {
    MP.partnerOn = true;
    mpShowPartner(true);
    mpUiRefresh();
  }
  if (jump) mpPlacePartner(true);
}

function mpSeedPartnerAtGrid() {
  if (MP.hasT || !MP.carReady || typeof VEH === 'undefined') return;
  try {
    const V = VEH, T = MP.T;
    const back = (MP.seqRank || 0) === 0 ? -5.2 : 5.2;
    const c = Math.cos(V.yaw), s = Math.sin(V.yaw);
    T.x = MP.S.x = V.x + c * back;
    T.z = MP.S.z = V.z + s * back;
    T.y = MP.S.y = V.y;
    T.yaw = MP.S.yaw = V.yaw;
    T.spd = MP.S.spd = 0;
    T.steer = MP.S.steer = 0;
    T.vx = T.vz = T.wy = 0;
    MP.hasT = true;
    mpPlacePartner(true);
  } catch (e) {}
}

function mpPartnerGone() {
  MP.partnerOn = false;
  MP.hasT = false;
  mpShowPartner(false);
  mpUiRefresh();
  mpUpdateTag(false);
}

function mpAnnounce() {
  if (!NET.live) return;
  MP.lastAnnounceAt = performance.now();
  NET.json({ type: 'game_hello', game: GAME_ID, from: MP.userId, seq: MP.seqRank });
  if (typeof VEH !== 'undefined') {
    NET.json({ type: 'game_car', from: MP.userId, d: mpSelfState() });
  }
}

function mpOnPacket(d) {
  if (!d || typeof d !== 'object') return;
  if (d.from && d.from === MP.userId) return;
  switch (d.type) {
    case 'game_hello': {
      const wasOff = !MP.partnerOn;
      MP.partnerOn = true;
      MP.helloAt = performance.now();
      MP.lastRxHelloAt = MP.helloAt;
      mpShowPartner(true);
      if (!MP.hasT) mpSeedPartnerAtGrid();
      if (wasOff) mpNotice('🟢 ' + MP.partnerName + ' piste çıktı!', 2500);
      if (NET.live && (!d.reply)) {
        NET.json({ type: 'game_hello', game: GAME_ID, from: MP.userId, seq: MP.seqRank, reply: 1 });
        if (typeof VEH !== 'undefined') NET.json({ type: 'game_car', from: MP.userId, d: mpSelfState() });
      }
      mpUiRefresh();
      break;
    }
    case 'game_car':
      mpOnCar(d.d);
      break;
    case 'game_hit':
      mpOnHit(d);
      break;
    case 'game_horn':
      mpPlayHornSound(true);
      mpNotice('📣 ' + MP.partnerName + ' korna çaldı!', 2000);
      break;
    case 'game_bye':
      mpPartnerGone();
      break;
  }
}

function mpHorn() {
  const now = performance.now();
  if (now - MP.lastHornAt < 320) return;
  MP.lastHornAt = now;
  mpPlayHornSound(false);
  if (NET.live) NET.json({ type: 'game_horn', from: MP.userId });
}

function mpTeleportToPartner() {
  if (!MP.partnerOn || !MP.hasT || typeof VEH === 'undefined' || typeof vehicleReset !== 'function') {
    mpNotice('⚪ ' + MP.partnerName + ' henüz oyunda değil', 2000);
    return;
  }
  const L = (typeof TRK !== 'undefined' && TRK.L) ? TRK.L : 1600;
  let ts = MP.T.s - 5.5;
  while (ts < 0) ts += L;
  while (ts >= L) ts -= L;
  const hw = (typeof TRK !== 'undefined' && TRK.hw) ? TRK.hw : 6;
  const td = clamp(MP.T.d || 0, -hw + 1.2, hw - 1.2);
  vehicleReset(ts, td, 0);
  if (typeof GS !== 'undefined') {
    GS.cut = true;
    GS.chaseInit = false;
  }
  mpNotice('⚡ ' + MP.partnerName + ' yanına ışınlandın', 1800);
}

// ------------------------ HUD VE 3B ARAÇ ÜSTÜ ETİKET ------------------------
function mpUiRefresh() {
  const st = document.getElementById('mpStat');
  const txt = MP.partnerOn
    ? '🟢 ' + MP.partnerName + ' aynı dünyada · birlikte sürüyorsunuz'
    : '⚪ Tek başına sürüyorsun (' + MP.partnerName + ' girince aracı yanında doğar)';
  if (st) st.textContent = txt;
  mpUpdateHud();
}

let _mpLastHudAt = 0;
function mpUpdateHud() {
  const hud = document.getElementById('mpHud');
  if (!hud) return;
  const now = performance.now();
  const hasNotice = MP.noticeText && now < MP.noticeUntil;
  const inDrive = typeof UI === 'undefined' || typeof ST === 'undefined' || UI.st === ST.JOGO || UI.st === ST.FITA;
  if (!inDrive || (!MP.partnerOn && !hasNotice)) {
    hud.style.display = 'none';
    return;
  }
  if (!MP.partnerOn && hasNotice) {
    hud.innerHTML = MP.noticeText;
    hud.style.display = 'block';
    return;
  }
  let line1 = '🟢 ' + MP.partnerName + ' pistte';
  if (MP.hasT && typeof VEH !== 'undefined') {
    const dist = Math.round(Math.hypot(MP.S.x - VEH.x, MP.S.z - VEH.z));
    const L = (typeof TRK !== 'undefined' && TRK.L) ? TRK.L : 1600;
    const myProg = (VEH.laps || 0) * L + (VEH.s || 0);
    const pProg = (MP.T.laps || 0) * L + (MP.T.s || 0);
    const rankTxt = myProg >= pProg ? '1/2 Öndesin' : '2/2 Takiptesin';
    line1 = '🟢 ' + MP.partnerName + ' · ' + dist + ' m · ' + rankTxt;
  }
  let line2 = '';
  if (hasNotice) {
    line2 = '<div style="color:#fff;margin-top:2px">' + MP.noticeText + '</div>';
  } else if (MP.T.best > 0) {
    line2 = '<div style="opacity:.82;font-size:11px">En iyi tur: ' + mpFmtLap(MP.T.best) + '</div>';
  }
  hud.innerHTML = line1 + line2;
  hud.style.display = 'block';
}

function mpUpdateTag(forceHide) {
  const tag = document.getElementById('mpTag');
  if (!tag) return;
  const inDrive = typeof UI === 'undefined' || typeof ST === 'undefined' || UI.st === ST.JOGO || UI.st === ST.FITA;
  if (forceHide || !inDrive || !MP.partnerOn || !MP.hasT || !MP.shown || typeof R === 'undefined' || !R.cam || !R.cam.vp) {
    tag.style.display = 'none';
    return;
  }
  const px = MP.S.x, py = MP.S.y + 1.85, pz = MP.S.z;
  const m = R.cam.vp;
  const cw = m[3] * px + m[7] * py + m[11] * pz + m[15];
  if (cw <= 0.4) {
    tag.style.display = 'none';
    return;
  }
  const nx = (m[0] * px + m[4] * py + m[8] * pz + m[12]) / cw;
  const ny = (m[1] * px + m[5] * py + m[9] * pz + m[13]) / cw;
  if (nx < -1.02 || nx > 1.02 || ny < -1.02 || ny > 1.02) {
    tag.style.display = 'none';
    return;
  }
  const sx = (nx * 0.5 + 0.5) * innerWidth;
  const sy = (0.5 - ny * 0.5) * innerHeight;
  const dist = typeof VEH !== 'undefined' ? Math.round(Math.hypot(MP.S.x - VEH.x, MP.S.z - VEH.z)) : 0;
  const txt = dist > 0 ? (MP.partnerName + ' · ' + dist + ' m') : MP.partnerName;
  if (tag.textContent !== txt) tag.textContent = txt;
  tag.style.left = sx.toFixed(1) + 'px';
  tag.style.top = sy.toFixed(1) + 'px';
  tag.style.display = 'block';
}

function mpFrame() {
  mpSendCar();
  mpPlacePartner();
  mpSoundFrame();
  mpUpdateTag(false);
  const now = performance.now();
  if (now - _mpLastHudAt > 120) {
    _mpLastHudAt = now;
    mpUpdateHud();
  }
  mpHousekeeping();
}

function mpHousekeeping() {
  const now = performance.now();
  if (MP.partnerOn && !MP.hasT && MP.helloAt && now - MP.helloAt > 200) {
    mpSeedPartnerAtGrid();
  }
  if (!NET.live && MP.retryAt && now >= MP.retryAt) {
    MP.retryAt = 0;
    NET.connect();
  }
  if (NET.live && now - MP.lastAnnounceAt > 3000) {
    mpAnnounce();
  }
  if (MP.partnerOn && now - Math.max(MP.lastRxCarAt, MP.lastRxHelloAt, MP.helloAt || 0) > 15000) {
    mpPartnerGone();
  }
}

// ------------------------ DOKUNMATİK KUMANDA -------------------------------
const TOUCH = {
  active: false,
  keys: 0
};

function mpIsTouch() {
  try {
    return (navigator.maxTouchPoints || 0) > 0 || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
  } catch (e) {
    return false;
  }
}

function mpApplyTouchKeys() {
  if (!TOUCH.active || typeof GS === 'undefined') return;
  if (TOUCH.keys) GS.held |= TOUCH.keys;
}

function mpLockLandscapeAndFullscreen() {
  try {
    if (MPSHARE && MPSHARE.present()) MPSHARE.fullscreen();
    else if (!document.fullscreenElement) {
      const el = document.documentElement;
      const r = el.requestFullscreen || el.webkitRequestFullscreen;
      if (r) { const p = r.call(el, { navigationUI: 'hide' }); if (p && p.catch) p.catch(() => {}); }
    }
  } catch (e) {}
  try {
    if (screen.orientation && screen.orientation.lock) {
      screen.orientation.lock('landscape').catch(() => {});
    }
  } catch (e) {}
  setTimeout(mpSyncViewport, 150);
  setTimeout(mpSyncViewport, 450);
}

function mpSyncViewport() {
  try {
    const ov = document.getElementById('mobrotate');
    if (ov) ov.style.display = (TOUCH.active && innerHeight > innerWidth) ? 'flex' : 'none';
  } catch (e) {}
  if (typeof rendererResize === 'function') {
    try { rendererResize(); } catch (e) {}
  }
}

function mpSetupControls() {
  TOUCH.active = mpIsTouch();
  if (TOUCH.active) {
    document.body.classList.add('has-touch');
    try {
      if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock('landscape').catch(() => {});
      }
    } catch (e) {}
  }
  addEventListener('resize', () => { mpSyncViewport(); setTimeout(mpSyncViewport, 200); });
  addEventListener('orientationchange', () => { setTimeout(mpSyncViewport, 150); setTimeout(mpSyncViewport, 450); });
  const b0 = document.getElementById('b0');
  if (b0) b0.addEventListener('click', () => {
    mpUnlockAudio();
    if (TOUCH.active) mpLockLandscapeAndFullscreen();
  });
  addEventListener('keydown', e => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'KeyG') mpHorn();
    else if (e.code === 'KeyT') mpTeleportToPartner();
  });
  mpSyncViewport();

  const bindHold = (id, bitFn) => {
    const el = document.getElementById(id);
    if (!el) return;
    const press = ev => {
      ev.preventDefault();
      mpUnlockAudio();
      TOUCH.active = true;
      document.body.classList.add('has-touch');
      const b = bitFn();
      TOUCH.keys |= b;
      if (typeof GS !== 'undefined') GS.held |= b;
      el.classList.add('on');
    };
    const release = ev => {
      if (ev) ev.preventDefault();
      const b = bitFn();
      TOUCH.keys &= ~b;
      if (typeof GS !== 'undefined') GS.held &= ~b;
      el.classList.remove('on');
    };
    el.addEventListener('pointerdown', press);
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('pointerleave', ev => { if (el.classList.contains('on')) release(ev); });
    el.addEventListener('lostpointercapture', release);
  };

  const bindTap = (id, fn) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('pointerdown', ev => {
      ev.preventDefault();
      mpUnlockAudio();
      el.classList.add('on');
      fn();
      setTimeout(() => el.classList.remove('on'), 100);
    });
  };

  bindHold('t-left', () => K_A);
  bindHold('t-right', () => K_D);
  bindHold('t-gas', () => K_W);
  bindHold('t-brake', () => K_S);
  bindHold('t-hand', () => K_SPACE);

  bindTap('t-cam', () => {
    if (typeof GS !== 'undefined') {
      GS.cam = (GS.cam + 1) % 3;
      GS.cut = true;
      GS.chaseInit = false;
      GS.tvCur = -1;
    }
  });
  bindTap('t-reset', () => {
    if (typeof VEH !== 'undefined' && typeof vehicleReset === 'function') {
      vehicleReset(VEH.s, clamp(VEH.d, -2, 2), 0);
      if (typeof GS !== 'undefined') { GS.cut = true; GS.chaseInit = false; }
    }
  });
  bindTap('t-pause', () => {
    if (typeof uiPause === 'function' && typeof UI !== 'undefined' && typeof ST !== 'undefined') {
      if (UI.st === ST.JOGO || UI.st === ST.FITA || UI.st === ST.BENCH) uiPause();
      else if (typeof uiResume === 'function') uiResume();
    }
  });
  bindTap('t-horn', () => mpHorn());
  bindTap('t-tp', () => mpTeleportToPartner());
}

function mpBoot() {
  mpResolveUser();
  mpSetupControls();
  mpBuildPartnerCar();
  try {
    if (MPSHARE && MPSHARE.on) MPSHARE.on(d => mpOnPacket(d));
    if (MPSHARE && MPSHARE.onState) {
      MPSHARE.onState(open => {
        if (open) {
          if (NET.ws) NET.close();
          NET.opened = false;
          MP.retryAt = 0;
          mpAnnounce();
        } else if (!NET.ws) {
          NET.closedByUser = false;
          MP.retryAt = 0;
          NET._probed = true;
          NET._openOwn();
        }
        mpUiRefresh();
      });
    }
  } catch (e) {}
  NET.connect();
  setTimeout(() => { try { mpAnnounce(); } catch (e) {} }, 600);
  if (typeof window !== 'undefined') {
    addEventListener('pagehide', () => {
      try { if (NET.live) NET.json({ type: 'game_bye', from: MP.userId }); } catch (e) {}
    });
  }
  mpUiRefresh();
}

BUILD.push(async () => {
  try { mpBoot(); } catch (e) { console.warn('[uno-mp] başlatılamadı:', e); }
});

try {
  window.__mp = {
    net: NET,
    mp: MP,
    snd: MPSND,
    packet: d => mpOnPacket(d),
    show: on => mpShowPartner(on),
    gone: () => mpPartnerGone(),
    collide: () => mpCollideCar(),
    horn: () => mpHorn(),
    teleport: () => mpTeleportToPartner(),
    carInfo: () => ({
      ownItems: CAR.set ? CAR.set.items.length : 0,
      ownGlass: CAR.glass ? CAR.glass.items.length : 0,
      partnerItems: MP.set ? MP.set.items.length : -1,
      carReady: MP.carReady,
      shown: R.drawables.indexOf(MP.drawable) >= 0
    }),
    state() {
      return {
        userId: MP.userId,
        partnerName: MP.partnerName,
        wsOpen: NET.live,
        partnerOn: MP.partnerOn,
        partnerCar: MP.carReady,
        hasPartnerPos: MP.hasT,
        shown: R.drawables.indexOf(MP.drawable) >= 0,
        partner: { x: +(MP.S.x || 0).toFixed(1), z: +(MP.S.z || 0).toFixed(1) },
        me: { x: +(VEH.x || 0).toFixed(1), z: +(VEH.z || 0).toFixed(1) }
      };
    }
  };
} catch (e) {}
