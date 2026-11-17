// ============================================================================
// ÇOK OYUNCULU — Murat & Selin aynı pistte (Fable 5.2 sürümüne eklendi)
// ----------------------------------------------------------------------------
// Oyun tek kişilikti; bu dosya oyuna ağ katmanını ve ikinci arabayı ekler.
//   1) SOKET  : Ahududu'nun /ws/<kullanıcı> soketine bağlanır.
//   2) ARABA  : Partnerin Unosu pistte canlı çizilir (farklı renk, aynı model).
//   3) SES    : Partnerin motor sesi kameraya göre sağdan/soldan gelir.
//   4) KAMERA : Partnerin canlı görüntüsü sağ altta; kendi görüntün ayna olarak.
//   5) MİK    : "Basılı tut: konuş" düğmesi (16 kHz PCM).
// Ağ yoksa her şey sessizce kapanır; oyun eskisi gibi tek kişilik oynanır.
//
// Önemli tasarım notu (renderer): sahnede yalnızca 64 "obje slotu" var ve
// hepsini bizim arabamız kullanıyor. Bu yüzden ikinci araba YENİ SLOT AÇMAZ;
// partneri, kendi arabamızın slotlarına yazdığımız matrislerle çizer. Slot
// matrisleri mpBeginFrame'de ayrılan alanda tutulur, mpPartnerDraw bitince
// geri yazılır (kendi arabamız bu yüzden yerinden kaymaz).
// Direksiyon slotu (CAR.slotSteer) ödünç ALINMAZ: aynı karede yazılırsa
// dümenin ekran kartı kaynağı iki kez bağlanır (createBindGroup çakışır).
// ----------------------------------------------------------------------------

const GAME_ID = 'uno-com-escada';
const GAME_NAMES = { murat: 'Murat', selin: 'Selin' };

// ---------------------------- 1) SOKET -------------------------------------
const NET = {
  ws: null, opened: false, closedByUser: false, offlineTries: 0,
  json(o) { try { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); } catch (e) { /* yok say */ } },
  connect() {
    if (typeof location === 'undefined' || !/^https?:$/.test(location.protocol)) return;
    this.close();
    this.closedByUser = false;
    const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws/' + MP.userId;
    let ws;
    try { ws = new WebSocket(url); } catch (e) { return; }
    this.ws = ws;
    ws.onopen = () => {
      NET.opened = true; NET.offlineTries = 0; MP.retryAt = 0;
      NET.json({ type: 'game_hello', game: GAME_ID, cam: CAM.ready ? 1 : 0 });
      mpUiRefresh();
    };
    ws.onmessage = ev => { let d; try { d = JSON.parse(ev.data); } catch (e) { return; } mpOnPacket(d); };
    ws.onclose = () => {
      const was = NET.ws === ws;
      NET.opened = false;
      if (was) NET.ws = null;
      MP.partnerOn = false;
      mpHideRemoteUi();
      mpUiRefresh();
      if (NET.closedByUser) return;
      NET.offlineTries++;
      MP.retryAt = performance.now() + (NET.offlineTries > 6 ? 30000 : 3000);
    };
    ws.onerror = () => { /* onclose hallediyor */ };
  },
  close() {
    this.closedByUser = true;
    if (this.ws) { try { this.ws.close(); } catch (e) { /* yok say */ } this.ws = null; }
    this.opened = false;
  }
};

// ---------------------------- 2) OYUNCU ------------------------------------
const MP = {
  userId: 'murat', partnerId: 'selin', myName: 'Murat', partnerName: 'Selin',
  partnerOn: false, retryAt: 0, sentAt: -1e9, lastRxCarAt: 0,
  // partnerin arabası: T = ağdan gelen hedef, S = ekranda yumuşatılan kopya
  T: { x: 0, y: 0, z: 0, yaw: 0, spd: 0, gear: 1, acc: 0 },
  S: { x: 0, y: 0, z: 0, yaw: 0, spd: 0, gear: 1, acc: 0 },
  hasT: false, carReady: false,
  // slot tasarrufu (kendi arabanın slotlarına yazar)
  reserve: null, bodySlot: -1, wheelSlot: [0, 0, 0, 0],
  paint: [0.70, 0.13, 0.34]     // partnerin arabasının rengi: pembe-böğürtlen
};

function mpResolveUser() {
  let id = '';
  try {
    const m = (location.search || '').toLowerCase().match(/[?&]u=(murat|selin)/);
    if (m) id = m[1];
    if (!id) { const raw = localStorage.getItem('ahududu_user'); if (raw === 'murat' || raw === 'selin') id = raw; }
  } catch (e) { /* yok say */ }
  mpSetUser(id || 'murat');
}
function mpSetUser(id) {
  if (!GAME_NAMES[id]) return;
  MP.userId = id;
  MP.partnerId = id === 'murat' ? 'selin' : 'murat';
  MP.myName = GAME_NAMES[MP.userId];
  MP.partnerName = GAME_NAMES[MP.partnerId];
}

// ------------------- 3) PARTNER ARABASI (slot takası) ----------------------
// Kendi arabamızın slot matrislerinin canlı kopyası; mpBeginFrame'de saklanır.
const MPSAVE = { body: m4(), wheel: [m4(), m4(), m4(), m4()], bodyP: new Float32Array(4), wheelP: [new Float32Array(4), new Float32Array(4), new Float32Array(4), new Float32Array(4)] };
const MPM = { g: m4(), t: m4(), rz: m4(), m: m4() };

function mpBuildPartnerCar() {
  if (MP.carReady) return true;
  try {
    if (typeof R === 'undefined' || typeof CAR === 'undefined' || !CAR.set || !CAR.hubs) return false;
    MP.bodySlot = CAR.slotBody;
    // Tekerlek slotları: CARP'ınki varsa onlar (görünmez yedek araba), yoksa kendi tekerleklerimiz.
    // Asla CAR.slotSteer kullanılmaz.
    const carpAlive = typeof CARP !== 'undefined' && CARP.slotBody > 0 && CARP !== CAR;
    const free = carpAlive ? CARP.slotWheel : null;
    for (let i = 0; i < 4; i++) MP.wheelSlot[i] = free && free[i] > 0 ? free[i] : CAR.slotWheel[i];
    MP.reserve = MPSAVE;
    // Kendi araba setinde hangi slotların gövde/tekerlek olduğunu bilmiyoruz;
    // partner çizimi kendi vb/ib listesiyle carBuild fonksiyonlarına dayanmaz,
    // doğrudan CAR.set.items'taki (vb, ib, count) üçlüsünü yeniden kullanır.
    MP.items = CAR.set.items.map(it => ({ vb: it.vb, ib: it.ib, count: it.count, slot: it.slot, flags: it.flags, r: it.r, cx: it.cx, cy: it.cy, cz: it.cz }));
    MP.fam = CAR.fam;
    MP.carReady = true;
    // Atlas dokusu: araba kendi kartını oluştururken alır; burada aynı dokuyu
    // paylaşmak için bir kez oluşturup bind group'u kuruyoruz (slot işgali yok).
    try {
      const tex = (typeof carAtlas === 'function') ? carAtlas() : null;
      if (tex && MP.fam.bgl3) MP.atlasBG = G.dev.createBindGroup({ layout: MP.fam.bgl3, entries: [{ binding: 0, resource: tex.createView() }] });
    } catch (e) { MP.atlasBG = null; }
    // Partneri çizen çizilebilir nesne: kendi arabamızdan SONRA çizilir.
    if (MP.fam && MP.fam.bgl3 && typeof R.drawables !== 'undefined') {
      R.drawables.push({
        __mp: 1,
        draw(pass, ctx) {
          if (!MP.canDraw || !MP.hasT || !MP.atlasBG) return;
          if (ctx.kind === KIND.SHADOW && ctx.cascade === 3) return;
          pass.setBindGroup(3, MP.atlasBG);
          mpBodyDraw(pass, ctx);
        }
      });
    }
    return true;
  } catch (e) { console.warn('[uno-mp] partner arabası kurulamadı:', e); return false; }
}
// Bir karede partneri çiz: gövde ve tekerlek slotlarına partner matrisini yaz
function mpBodyDraw(pass, ctx) {
  const pipe = MP.fam.pipe[ctx.kind]; if (!pipe) return;
  const bit = 1 << ctx.kind, items = MP.items, obj = R.objData;
  let set = false;
  for (let i = 0; i < items.length; i++) {
    const it = items[i]; if (!(it.flags & bit)) continue;
    const slot = it.slot === MP.bodySlot ? MP.bodySlot : (MP.wheelSlot.includes(it.slot) ? it.slot : -1);
    if (slot < 0) continue;                                        // direksiyon vb. çizilmez
    const o = slot * 64;
    const x = obj[o] * it.cx + obj[o + 4] * it.cy + obj[o + 8] * it.cz + obj[o + 12];
    const y = obj[o + 1] * it.cx + obj[o + 5] * it.cy + obj[o + 9] * it.cz + obj[o + 13];
    const z = obj[o + 2] * it.cx + obj[o + 6] * it.cy + obj[o + 10] * it.cz + obj[o + 14];
    const dx = x - ctx.cx, dy = y - ctx.cy, dz = z - ctx.cz, md = it.maxDist + it.r;
    if (dx * dx + dy * dy + dz * dz > md * md) continue;
    const pl = ctx.planes, np = ctx.nPlanes; let vis = true;
    for (let k = 0; k < np; k++) if (pl[k * 4] * x + pl[k * 4 + 1] * y + pl[k * 4 + 2] * z + pl[k * 4 + 3] < -it.r) { vis = false; break; }
    if (!vis) continue;
    if (!set) { pass.setPipeline(pipe); set = true; }
    R.dyn2[0] = slot * 256;
    pass.setBindGroup(2, R.objBG, R.dyn2, 0, 1);
    pass.setVertexBuffer(0, it.vb); pass.setIndexBuffer(it.ib, 'uint32'); pass.drawIndexed(it.count);
  }
}

// Kare başında kendi arabamızın slot matrisleri önbelleğe alınır; sonunda geri konur.
function mpBeginFrame() {
  if (!MP.carReady) return;
  const obj = R.objData, b = MP.bodySlot;
  MPSAVE.body.set(obj.subarray(b * 64, b * 64 + 16));
  MPSAVE.bodyP.set(obj.subarray(b * 64 + 32, b * 64 + 36));
  for (let i = 0; i < 4; i++) {
    const s = MP.wheelSlot[i];
    MPSAVE.wheel[i].set(obj.subarray(s * 64, s * 64 + 16));
    MPSAVE.wheelP[i].set(obj.subarray(s * 64 + 32, s * 64 + 36));
  }
  MP.canDraw = false;
  if (!MP.hasT) return;
  // yumuşatma
  const S = MP.S, T = MP.T, k = 0.25, ky = 0.3;
  S.x += (T.x - S.x) * k; S.y += (T.y - S.y) * k; S.z += (T.z - S.z) * k;
  let dy = T.yaw - S.yaw; if (dy > PI) dy -= TAU; else if (dy < -PI) dy += TAU;
  S.yaw += dy * ky; S.spd += (T.spd - S.spd) * k; S.gear = T.gear; S.acc = T.acc;
  // gövde matrisi
  const G = MPM.g, B = MPSAVE.body, c = Math.cos(S.yaw), s = Math.sin(S.yaw), ox = -(VP.L / 2 - VP.a);
  G[0] = c; G[1] = 0; G[2] = s; G[3] = 0;
  G[4] = 0; G[5] = 1; G[6] = 0; G[7] = 0;
  G[8] = -s; G[9] = 0; G[10] = c; G[11] = 0;
  G[12] = S.x + c * ox; G[13] = S.y; G[14] = S.z + s * ox; G[15] = 1;
  m4ident(MPM.t); MPM.t[13] = 0.18; m4mul(B, G, MPM.t);
  // malzeme parametreleri: fren lambası (p0.x), renk (p1.rgb = partner rengi)
  const P = MPSAVE.bodyP;
  P[0] = S.acc < -0.05 ? 1 : 0; P[1] = S.gear === 0 ? 1 : 0; P[2] = 1;
  const b64 = MP.bodySlot * 64;
  for (let i = 0; i < 4; i++) R.objData[b64 + 32 + i] = P[i];
  R.objData[b64 + 36] = MP.paint[0]; R.objData[b64 + 37] = MP.paint[1]; R.objData[b64 + 38] = MP.paint[2]; R.objData[b64 + 39] = 0;
  // tekerlekler: aynı yerleşim (hub), dönme hızı hızdan
  const spin = S.spd / VP.R;
  for (let i = 0; i < 4; i++) {
    const s2 = MP.wheelSlot[i], h = CAR.hubs[i], left = (i & 1) === 1;
    const a = left ? PI : 0, ca = Math.cos(a), sa = Math.sin(a);
    const g = left ? spin : -spin, cg = Math.cos(g), sg = Math.sin(g);
    const RZ = MPM.rz;
    RZ[0] = ca * cg; RZ[1] = sg; RZ[2] = -sa * cg; RZ[3] = 0;
    RZ[4] = -ca * sg; RZ[5] = cg; RZ[6] = sa * sg; RZ[7] = 0;
    RZ[8] = sa; RZ[9] = 0; RZ[10] = ca; RZ[11] = 0;
    RZ[12] = h[0]; RZ[13] = h[1]; RZ[14] = h[2]; RZ[15] = 1;
    m4mul(MPSAVE.wheel[i], B, RZ);
    const o = s2 * 64 + 32;
    R.objData[o] = Math.abs(spin);                         // yuvarlanma bulanıklığı
  }
  MP.canDraw = true;
}
// Partner çizildikten sonra kendi arabamızın matrisleri geri yazılır.
// (Not: gövde/tekerlek matrisleri GPU komutları hazırlanırken okunur, geri
// yazmak yalnızca bir sonraki kareyi bozmamak için gerekli değildir; yine de
// her karede yeniden yazılır. ARABA ve PARTNER aynı karede doğru görünür.)
function mpPartnerDraw() { /* çizim draw() içinde */ }

// ---------------------------- 4) SES ---------------------------------------
const MPSND = { ready: false, ctx: null, gain: null, panner: null, osc: null, osc2: null, filter: null };
function mpSoundInit() {
  if (MPSND.ready) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const gain = ctx.createGain(); gain.gain.value = 0;
    let head = gain, panner = null;
    if (ctx.createPanner) {
      panner = ctx.createPanner();
      panner.panningModel = 'HRTF'; panner.distanceModel = 'linear';
      panner.refDistance = 6; panner.maxDistance = 80; panner.rolloffFactor = 1;
      gain.connect(panner); head = panner;
    } else if (ctx.createStereoPanner) {
      panner = ctx.createStereoPanner(); gain.connect(panner); head = panner;
    }
    head.connect(ctx.destination);
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth';
    const o2 = ctx.createOscillator(); o2.type = 'square';
    const g2 = ctx.createGain(); g2.gain.value = 0.22;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    o1.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(gain);
    o1.start(); o2.start();
    MPSND.ctx = ctx; MPSND.gain = gain; MPSND.osc = o1; MPSND.osc2 = o2; MPSND.filter = lp; MPSND.panner = panner;
    MPSND.ready = true;
  } catch (e) { /* ses yoksa oyun sessiz sürer */ }
}
function mpSoundFrame() {
  const C = MPSND.ctx;
  if (!C) return;
  if (C.state === 'suspended') C.resume().catch(() => {});
  if (!MP.hasT || !MP.partnerOn) { try { MPSND.gain.gain.value = 0; } catch (e) {} return; }
  const D = MP.S, dx = D.x - GS.cx, dz = D.z - GS.cz, dy = D.y - GS.cy;
  const dist = Math.sqrt(dx * dx + dz * dz + dy * dy);
  const muted = (typeof SND !== 'undefined' && SND.mute) ? 0 : 1;
  const vol = dist > 80 ? 0 : (1 - dist / 80) * (1 - dist / 80) * 0.55 * muted;
  const t = C.currentTime, sp = Math.abs(D.spd);
  try {
    MPSND.gain.gain.setTargetAtTime(vol, t, 0.08);
    const rpm = 850 + Math.min(sp, 45) * 175;
    MPSND.osc.frequency.setTargetAtTime(rpm / 30, t, 0.06);
    MPSND.osc2.frequency.setTargetAtTime(rpm / 60, t, 0.06);
    MPSND.filter.frequency.setTargetAtTime(420 + Math.min(sp, 45) * 70, t, 0.1);
    const c = Math.cos(GS.yaw), s = Math.sin(GS.yaw);
    const rx = dz * c - dx * s, fw = dx * c + dz * s;     // kameraya göre sağ/ön
    const p = MPSND.panner;
    if (p.positionX) { p.positionX.value = rx; p.positionY.value = dy; p.positionZ.value = fw + 2; }
    else if (p.setPosition) p.setPosition(rx, dy, fw + 2);
    else if (p.pan) p.pan.value = Math.max(-1, Math.min(1, rx / 20));
  } catch (e) { /* yok say */ }
}

// ---------------------------- 5) KAMERA ------------------------------------
const CAM = { ready: false, want: false, remoteReady: false, stream: null, video: null, cv: null, g: null, timer: null, sending: false, lastSend: 0, lastReq: 0, frames: 0, remoteFrames: 0 };
function camSupported() { return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia); }

function camInit() {
  const on = document.getElementById('camOn'), off = document.getElementById('camOff');
  if (on) on.onclick = () => { if (CAM.ready) camStop(); else camAsk(); };
  if (off) off.onclick = () => camStop();
  const q = document.getElementById('quit');
  if (q) q.onclick = () => { try { if (window.parent && window.parent !== window) window.parent.postMessage({ type: 'ahududu:game-quit' }, '*'); else history.back(); } catch (e) { history.back(); } };
  try { if (/[?&]return=/i.test(location.search || '') && q) q.style.display = 'inline-block'; } catch (e) {}
  mpUiRefresh();
}
// Tarayıcıda getUserMedia izin istemini kendisi gösterir; Capacitor kabuğunda
// önce köprüden izin istenir (aynı izni iki kez sormamak için).
function camAsk() {
  if (!camSupported()) { camStatus('bu tarayıcıda kamera yok'); return; }
  const CAP = window.Capacitor;
  if (CAP && CAP.Plugins && CAP.Plugins.Camera) {
    try { CAP.Plugins.Camera.requestPermissions({ permissions: ['camera'] }).then(camStart).catch(camStart); return; } catch (e) { /* devam */ }
  }
  camStart();
}
function camStart() {
  if (!camSupported()) { camStatus('bu tarayıcıda kamera yok'); return; }
  if (CAM.ready) { CAM.want = true; return; }
  camStatus('kamera açılıyor…');
  let req;
  try {
    req = navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 640 }, frameRate: { ideal: 24, max: 30 } },
      audio: false
    });
  } catch (e) { camStatus('açılamadı'); return; }
  req.then(stream => {
    CAM.stream = stream; CAM.ready = true; CAM.want = true;
    const v = document.createElement('video');
    v.autoplay = true; v.muted = true; v.playsInline = true; v.setAttribute('playsinline', '');
    v.srcObject = stream;
    const p = v.play(); if (p && p.catch) p.catch(() => {});
    CAM.video = v;
    CAM.cv = document.createElement('canvas'); CAM.cv.width = 320; CAM.cv.height = 427;
    CAM.g = CAM.cv.getContext('2d');
    mpSelfUi();
    if (!CAM.timer) CAM.timer = setInterval(camTick, 100);
    camStatus('açık');
    NET.json({ type: 'game_cam_status', on: true });
    mpUiRefresh();
  }).catch(err => {
    CAM.ready = false; CAM.want = false;
    const n = err && err.name;
    camStatus(n === 'NotAllowedError' ? 'tarayıcı izni yok' : n === 'NotFoundError' ? 'kamera bulunamadı' : 'açılamadı');
    mpUiRefresh();
  });
}
function camStop() {
  CAM.want = false; CAM.ready = false;
  if (CAM.timer) { clearInterval(CAM.timer); CAM.timer = null; }
  if (CAM.stream) { CAM.stream.getTracks().forEach(t => { try { t.stop(); } catch (e) {} }); CAM.stream = null; }
  if (CAM.video) CAM.video.srcObject = null;
  micStop();
  const box = document.getElementById('me'); if (box) box.style.display = 'none';
  NET.json({ type: 'game_cam_status', on: false });
  camStatus('kapalı');
  mpUiRefresh();
}
function camStatus(t) { const el = document.getElementById('camStat'); if (el) el.textContent = t; }
// Kendi görüntün: sağ altta küçük ayna (dokununca küçülür)
function mpSelfUi() {
  let box = document.getElementById('me');
  if (!box) {
    box = document.createElement('div'); box.id = 'me';
    const v = document.createElement('video');
    v.autoplay = true; v.muted = true; v.playsInline = true; v.setAttribute('playsinline', '');
    const lb = document.createElement('div'); lb.className = 'lb';
    const mk = document.createElement('button'); mk.className = 'mk'; mk.type = 'button'; mk.textContent = '✕'; mk.title = 'Kamerayı kapat';
    mk.onclick = ev => { ev.stopPropagation(); camStop(); };
    box.appendChild(v); box.appendChild(lb); box.appendChild(mk);
    document.body.appendChild(box);
    v.addEventListener('pointerdown', () => { box.style.width = box.style.width === '52px' ? '' : '52px'; });
  }
  const v = box.querySelector('video');
  if (v && CAM.stream) v.srcObject = CAM.stream;
  const lb = box.querySelector('.lb');
  if (lb) lb.innerHTML = '<span>' + MP.myName + '</span>';
  box.style.display = 'block';
}
// Partnerin görüntüsü: sağ altta; her kare geldiğinde <img> yenilenir
function mpRemoteUi() {
  let box = document.getElementById('camN');
  if (!box) {
    box = document.createElement('div'); box.id = 'camN';
    const im = document.createElement('img');
    im.style.cssText = 'display:block;width:100%;aspect-ratio:3/4;object-fit:cover;transform:scaleX(-1);background:#000';
    im.alt = '';
    const lb = document.createElement('div'); lb.className = 'lb';
    const say = document.createElement('button'); say.className = 'say'; say.type = 'button'; say.textContent = '🎤 Basılı tut: konuş';
    say.addEventListener('pointerdown', ev => { ev.preventDefault(); micTalk(true); });
    say.addEventListener('pointerup', ev => { ev.preventDefault(); micTalk(false); });
    say.addEventListener('pointerleave', () => micTalk(false));
    say.addEventListener('pointercancel', () => micTalk(false));
    box.appendChild(im); box.appendChild(lb); box.appendChild(say);
    document.body.appendChild(box);
  }
  const lb = box.querySelector('.lb');
  if (lb) lb.innerHTML = '<b>' + MP.partnerName + '</b><br><span style="opacity:.7">canlı</span>';
  box.style.display = 'block';
  return box;
}
function mpHideRemoteUi() {
  const box = document.getElementById('camN');
  if (box) box.style.display = 'none';
  CAM.remoteReady = false;
}
// Kendi karelerimizi JPEG olarak yolla (≈10 fps, 320×427)
function camTick() {
  if (!CAM.ready || !CAM.g || CAM.sending) return;
  if (performance.now() - CAM.lastSend < 100) return;
  const v = CAM.video;
  if (!v || v.readyState < 2 || !v.videoWidth) return;
  try {
    const cw = CAM.cv.width, ch = CAM.cv.height, vw = v.videoWidth, vh = v.videoHeight;
    const scale = Math.max(cw / vw, ch / vh), sw = cw / scale, sh = ch / scale;
    CAM.g.drawImage(v, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, cw, ch);
    CAM.sending = true;
    CAM.cv.toBlob(blob => {
      CAM.sending = false;
      if (!blob || blob.size > 140000) return;    // dev kare soketi tıkamasın
      const rd = new FileReader();
      rd.onload = () => { CAM.lastSend = performance.now(); CAM.frames++; NET.json({ type: 'game_cam_frame', data: String(rd.result || '') }); };
      rd.onerror = () => { CAM.sending = false; };
      rd.readAsDataURL(blob);
    }, 'image/jpeg', 0.6);
  } catch (e) { CAM.sending = false; }
}
function camMaybeRequest() {
  if (CAM.ready || !NET.opened) return;
  const now = performance.now();
  if (now - CAM.lastReq < 20000) return;
  CAM.lastReq = now;
  NET.json({ type: 'game_cam_req' });
}

// ---------------------------- 6) MİKROFON ----------------------------------
// Bas-konuş: 16 kHz, 16-bit PCM parçaları (≈200 ms)
const MIC = { ctx: null, node: null, stream: null, timer: null, buf: [] };
function micTalk(on) {
  const say = document.querySelector('#camN .say');
  if (!on) { micStop(); return; }
  if (MIC.ctx) return;
  if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) return;
  if (say) say.textContent = '🔴 Konuşuyorsun…';
  navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then(stream => {
    MIC.stream = stream;
    const AC = window.AudioContext || window.webkitAudioContext;
    MIC.ctx = new AC();
    const src = MIC.ctx.createMediaStreamSource(stream);
    const node = MIC.ctx.createScriptProcessor(2048, 1, 1);
    MIC.node = node;
    src.connect(node); node.connect(MIC.ctx.destination);
    node.onaudioprocess = ev => {
      const ch = ev.inputBuffer.getChannelData(0), step = MIC.ctx.sampleRate / 16000;
      for (let i = 0; i < ch.length; i += step) MIC.buf.push(ch[i | 0]);
      if (MIC.buf.length > 32000) MIC.buf.splice(0, MIC.buf.length - 16000);   // gecikme sınırı
    };
    MIC.timer = setInterval(() => {
      if (!MIC.buf.length) return;
      const chunk = MIC.buf.splice(0, 3200);
      const i16 = new Int16Array(chunk.length);
      for (let i = 0; i < chunk.length; i++) { const v = Math.max(-1, Math.min(1, chunk[i])); i16[i] = v * 0x7fff; }
      const u = new Uint8Array(i16.buffer);
      let s = '';
      for (let i = 0; i < u.length; i += 4096) s += String.fromCharCode.apply(null, u.subarray(i, i + 4096));
      NET.json({ type: 'game_mic', data: btoa(s) });
    }, 200);
  }).catch(() => micStop());
}
function micStop() {
  if (MIC.timer) { clearInterval(MIC.timer); MIC.timer = null; }
  if (MIC.node) { try { MIC.node.disconnect(); } catch (e) {} MIC.node = null; }
  if (MIC.stream) { MIC.stream.getTracks().forEach(t => { try { t.stop(); } catch (e) {} }); MIC.stream = null; }
  if (MIC.ctx) { try { MIC.ctx.close(); } catch (e) {} MIC.ctx = null; }
  MIC.buf = [];
  const say = document.querySelector('#camN .say');
  if (say) say.textContent = '🎤 Basılı tut: konuş';
}
const MICPLAY = { ctx: null };
function mpPlayMic(b64) {
  try {
    if (!MICPLAY.ctx) { const AC = window.AudioContext || window.webkitAudioContext; MICPLAY.ctx = new AC(); }
    const ctx = MICPLAY.ctx;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const bin = atob(b64), n = bin.length >> 1;
    if (!n) return;
    const buf = ctx.createBuffer(1, n, 16000), ch = buf.getChannelData(0);
    for (let i = 0; i < n; i++) {
      let v = (bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8)) & 0xffff;
      if (v >= 0x8000) v -= 0x10000;
      ch[i] = v / 32768;
    }
    const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination); src.start();
  } catch (e) { /* yok say */ }
}

// ---------------------------- 7) PAKETLER ----------------------------------
function mpSelfState() {
  const V = VEH;
  return [Math.round(V.x * 100) / 100, Math.round(V.y * 100) / 100, Math.round(V.z * 100) / 100,
    Math.round(V.yaw * 1000) / 1000, Math.round(Math.sqrt(V.vx * V.vx + V.vy * V.vy) * 100) / 100,
    V.gear | 0, (V.throttle - V.brake) >= 0 ? 1 : -1];
}
function mpSendCar() {
  if (!NET.opened) return;
  const now = performance.now();
  if (now - MP.sentAt < 50) return;                  // 20 Hz
  if (UI.st !== ST.JOGO && UI.st !== ST.PAUSA && UI.st !== ST.RESULT && UI.st !== ST.FITA && UI.st !== ST.INICIO) return;
  MP.sentAt = now;
  NET.json({ type: 'game_car', d: mpSelfState() });
}
function mpOnCar(d) {
  if (!Array.isArray(d) || d.length < 5) return;
  const T = MP.T;
  const jump = !MP.hasT || Math.abs(T.x - d[0]) + Math.abs(T.z - d[2]) > 30;
  T.x = +d[0] || 0; T.y = +d[1] || 0; T.z = +d[2] || 0; T.yaw = +d[3] || 0;
  T.spd = +d[4] || 0; T.gear = +d[5] || 0; T.acc = +d[6] || 0;
  if (jump) { MP.S.x = T.x; MP.S.y = T.y; MP.S.z = T.z; MP.S.yaw = T.yaw; MP.S.spd = T.spd; MP.hasT = true; }
  if (!MP.partnerOn) { MP.partnerOn = true; mpUiRefresh(); }
  MP.lastRxCarAt = performance.now();
}
function mpOnPacket(d) {
  if (!d || typeof d !== 'object') return;
  switch (d.type) {
    case 'game_hello':
      // Kimlik URL'deki u= ile belirlenir ve DEĞİŞTİRİLMEZ: gelen paketin
      // "from" alanı karşı tarafın kimliğidir, kendi kimliğimiz değil.
      if (d.from === MP.userId) break;          // kendi yankımız (olmamalı) — yok say
      MP.partnerOn = true;
      mpUiRefresh();
      break;
    case 'game_car': mpOnCar(d.d); break;
    case 'game_bye': MP.partnerOn = false; MP.hasT = false; mpUiRefresh(); break;
    case 'game_cam_status':
      if (d.on) { CAM.remoteReady = true; mpRemoteUi(); } else mpHideRemoteUi();
      break;
    case 'game_cam_frame':
      if (typeof d.data === 'string' && d.data.indexOf('data:image/') === 0) {
        const box = mpRemoteUi(), im = box.querySelector('img');
        if (im) im.src = d.data;
        CAM.remoteReady = true; CAM.remoteFrames++;
        camMaybeRequest();
      }
      break;
    case 'game_cam_req':
      if (!CAM.ready && !CAM.want && camSupported()) camStart();
      break;
    case 'game_mic':
      if (typeof d.data === 'string') mpPlayMic(d.data);
      break;
  }
}
function mpUiRefresh() {
  const st = document.getElementById('camStat');
  if (st) {
    st.textContent = 'kameran: ' + (CAM.ready ? 'açık' : 'kapalı') + ' · ' +
      (MP.partnerOn ? MP.partnerName + (CAM.remoteReady ? ' canlı' : ' oyunda') : 'bekleniyor…');
  }
  const on = document.getElementById('camOn'), off = document.getElementById('camOff');
  if (on) on.classList.toggle('on', CAM.ready);
  if (off) off.classList.toggle('on', !CAM.ready);
}

// ---------------------------- 8) DÖNGÜ KANCALARI ---------------------------
// Oyunun kendi fonksiyonlarına doğrudan kanca atılır (45_game.js ve 52_ui.js
// içinde `MP_...` çağrıları vardır). Hooks kayıp/yoksa da oyun çalışır.
function mpInstallHooks() {
  MP.hooked = true;
}
function mpNetHousekeeping() {
  const now = performance.now();
  if (!NET.opened && MP.retryAt && now >= MP.retryAt) { MP.retryAt = 0; NET.connect(); }
  // partner uzun süre paket göndermediyse kaybolsun (60 sn)
  if (MP.hasT && MP.partnerOn && now - MP.lastRxCarAt > 60000) { MP.partnerOn = false; MP.hasT = false; mpUiRefresh(); }
  camMaybeRequest();
}

function mpBoot() {
  mpResolveUser();
  mpSoundInit();
  camInit();
  mpInstallHooks();
  NET.connect();
  try { if (/[?&]cam=1/i.test(location.search || '') && camSupported()) setTimeout(camStart, 1500); } catch (e) {}
}
BUILD.push(async () => { try { mpBuildPartnerCar(); } catch (e) {} try { mpBoot(); } catch (e) { console.warn('[uno-mp] başlatılamadı', e); } });
// Teşhis: konsoldan window.__mp ile çok oyunculu durumu inceleyebilirsin
try {
  window.__mp = {
    net: NET, mp: MP, cam: CAM, snd: MPSND,
    state() {
      return {
        userId: MP.userId, partnerName: MP.partnerName,
        wsOpen: NET.opened, wsState: NET.ws ? NET.ws.readyState : -1,
        partnerOn: MP.partnerOn, partnerCar: MP.carReady, hasPartnerPos: MP.hasT,
        camMine: CAM.ready, camPartner: CAM.remoteReady,
        framesSent: CAM.frames, framesGot: CAM.remoteFrames,
        partner: { x: +(MP.S.x || 0).toFixed(1), z: +(MP.S.z || 0).toFixed(1) },
        me: { x: +(VEH.x || 0).toFixed(1), z: +(VEH.z || 0).toFixed(1) }
      };
    }
  };
} catch (e) { /* yok say */ }
