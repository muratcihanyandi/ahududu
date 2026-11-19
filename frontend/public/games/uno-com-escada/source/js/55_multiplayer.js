// ============================================================================
// ÇOK OYUNCULU — Murat & Selin aynı pistte
// ----------------------------------------------------------------------------
//   1) SOKET  : Ahududu'nun /ws/<kullanıcı> soketine bağlanır.
//   2) ARABA  : Partnerin Unosu pistte CANLI çizilir (kendi arabamızın ayrı
//               kopyası: kendi objeleri, kendi slotları, partnerin rengi).
//   3) SES    : Partnerin motor sesi kameraya göre sağdan/soldan gelir.
//   4) YARIŞ  : Herkes aynı anda "Başla"ya basınca geri sayım başlar; iki araba
//               da aynı anda start çizgisinden kalkar ve tur süreleri adil olur.
//
// KAMERA YOKTUR: video akışı (getUserMedia/WebRTC/JPEG yayını) bu sürümde
// tamamen kaldırıldı. Bu, telefonda her saniye işlemci ve soket yükü
// yaratıyordu (mobil FPS'in düşmesinin başlıca sebeplerinden biri). Mikrofon
// ("basılı tut: konuş") yalnızca partner ekrana girdiğinde açılan küçük bir
// düğme olarak duruyor; hiçbir şey otomatik açılmaz.
//
// ARABA ÇİZİMİ (önemli): Bu oyunda objelerin sırası CAR.build() içinde
// belirlenir: gövde = slotBody, 4 tekerlek = slotWheel[], direksiyon =
// slotSteer. Partner için CAR'ın gövde/tekerlek meshleri KENDİ objelerimize
// ekleniyor; yani partnerin arabası ayrı objeler ve ayrı slotlarla çizilir —
// kendi arabamızın matrisleri hiç ödünç alınmaz (eski sürüm slotları takas
// ediyordu; bu hem titremeye hem de partnerin bazen görünmemesine yol açıyordu).
// Eski kodun CAR.fam.bgl3 / carAtlas() üzerinden yaptığı bind group'a da gerek
// kalmadı: MeshSet.draw() zaten R.drawables sırasında doğru atlası bağlar.
// ----------------------------------------------------------------------------

const GAME_ID = 'uno-com-escada';
const GAME_NAMES = { murat: 'Murat', selin: 'Selin' };
// Bu dosya her zaman ana sayfanın içinde çalışır (oyun iframe'i kendi
// penceresidir). Eski kodda kalan `IS_TOP` referansı bir ReferenceError
// yüzünden çok oyunculuyu baştan düşürüyordu; artık burada tanımlıdır.
const IS_TOP = (() => { try { return window.top === window.self; } catch (e) { return false; } })();
const MP_PAINT = [0.70, 0.13, 0.34];      // partnerin arabasının rengi: pembe-böğürtlen
const MP_MINE = [0.13, 0.33, 0.68];       // benim arabamın rengi (açılışta bir kez yazılır)
const MP_TICK_HZ = 20;                    // saniyede gönderilen durum paketi
const MP_COUNTDOWN = 3.2;                 // "Başla"dan sonra geri sayım (sn)

// ---------------------------- 1) SOKET -------------------------------------
// Ana sayfa (Ahududu kabuğu) zaten aynı kullanıcı için bir soket açmış olabilir.
// İki ayrı soket açmak sunucuda iki bağlantı demek; kampüs/otel Wi-Fi'sinde
// birleşimi kaldırmayan yönlendiricilerde bağlantı düşmesine yol açıyordu.
// Bu yüzden oyunun paketleri mümkünse kabuğun soketinden geçer.
//
// ÖNEMLİ: Oyun AYRI bir iframe penceresinde çalışır. Eski kod yalnızca
// `window.__ahududuGameBus` arıyordu; o nesne ise kabuğun kendi penceresine
// yazılıyordu ve oyundan hiçbir zaman görülemiyordu. Ayrıca bir `on(...)`
// dinleyicisi de yoktu: kabuktan gelen partner paketleri hiç işlenmiyor,
// "Başla"nın gönderdiği geri sayım karşı tarafta yarışı başlatmıyordu.
// Artık köprü iki yolla kurulur:
//   • aynı köken: kabuk `__ahududuGameBus` nesnesini BU pencereye yazar,
//   • her durumda: `postMessage({__ahududu:1, kind:'send'|'ping'|...})`.
const BRIDGE_TAG = '__ahududu';
const MPSHARE = (() => {
  try {
    const direct = window.__ahududuGameBus;
    const handlers = new Set();          // gelen partner paketleri
    const watchers = new Set();          // bağlantı durumu değişimleri
    const pending = {};                  // durum yoklaması yanıtları: id -> fn
    let seq = 0;

    const emit = open => { share.ready = !!open; watchers.forEach(fn => { try { fn(!!open); } catch (e) { /* yok say */ } }); };
    const post = m => {
      try { if (window.parent && window.parent !== window) window.parent.postMessage(Object.assign({ [BRIDGE_TAG]: 1 }, m), '*'); } catch (e) { /* yok say */ }
    };

    const share = {
      ready: false,
      /** Köprü kuruldu mu (kabuk oyun iframe'ini tanıdı mı)? */
      present() { return !!(direct || this.ready); },
      open() { if (direct) { try { return !!direct.open(); } catch (e) { /* yok say */ } } return !!this.ready; },
      send(o) {
        if (direct) { try { return !!direct.send(o); } catch (e) { /* yok say */ } }
        post({ kind: 'send', payload: o });
        return !!this.ready;
      },
      on(fn) { if (typeof fn === 'function') handlers.add(fn); },
      onState(fn) { if (typeof fn === 'function') watchers.add(fn); },
      fullscreen() {
        if (direct && typeof direct.requestFullscreen === 'function') { try { direct.requestFullscreen(); return; } catch (e) { /* yok say */ } }
        post({ kind: 'fullscreen' });
      },
      /** Kabuk gerçekten cevap veriyor mu? Kabuk yoksa kendi soketimizi açarız. */
      probe() {
        return new Promise(resolve => {
          if (direct) { resolve(true); return; }
          const id = ++seq;
          pending[id] = () => resolve(true);
          post({ kind: 'ping' });
          post({ kind: 'state?', id });
          setTimeout(() => { if (pending[id]) { delete pending[id]; resolve(false); } }, 1500);
        });
      }
    };

    addEventListener('message', ev => {
      const d = ev.data;
      if (!d || d[BRIDGE_TAG] !== 1) return;
      if (d.kind === 'recv' && d.payload) {
        handlers.forEach(fn => { try { fn(d.payload); } catch (e) { /* yok say */ } });
      } else if (d.kind === 'state') {
        if (d.id >= 0 && pending[d.id]) { const fn = pending[d.id]; delete pending[d.id]; fn(!!d.open); }
        else if (d.id === -1) emit(d.open);
      } else if (d.kind === 'ready') {
        emit(true);
      }
    });

    post({ kind: 'hello' });             // kabuk bizi tanısın
    return share;
  } catch (e) { return null; }
})();

const NET = {
  ws: null, opened: false, closedByUser: false, offlineTries: 0,
  get live() { return this.opened || (MPSHARE ? MPSHARE.open() : false); },
  json(o) {
    if (MPSHARE && MPSHARE.open()) {
      if (MPSHARE.send(o) !== false) return;
    }
    try { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); } catch (e) { /* yok say */ }
  },
  // Oyun kendi soketini açar; kabuğun soketi ayaktaysa ve bu pencere bir
  // iframe değilse kabuğun soketi tercih edilir.
  connect() {
    if (typeof location === 'undefined') return;
    const httpMode = /^https?:$/.test(location.protocol);
    if (!httpMode) return;                                   // file:// (deneme) → yalnızca çevrimdışı
    if (MPSHARE && MPSHARE.open()) { this.opened = false; MP.retryAt = 0; mpUiRefresh(); return; }
    if (MPSHARE && !this._probed) { this._probed = true; MPSHARE.probe().then(ok => { if (ok) { MP.retryAt = 0; NET.opened = false; mpUiRefresh(); } else NET._openOwn(); }); return; }
    this._openOwn();
  },
  _openOwn() {
    this.close();
    this.closedByUser = false;
    // Doğru sunucu: uygulama localhost'tan (Capacitor) açıldığında soket canlı
    // sunucuya gitmelidir (websocket.ts ile aynı kural).
    let host = location.host, proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    // Test/teşhis: ?wsserver=host:port veya ?wsport=N ile soket adresi
    // değiştirilebilir (yerel röle sunucusuyla çift oyunculu deneme).
    try {
      const wsOverride = new URLSearchParams(location.search).get('wsserver');
      const wsPort = new URLSearchParams(location.search).get('wsport');
      if (wsOverride) { host = wsOverride; proto = /^https/.test(location.protocol) ? 'wss://' : 'ws://'; }
      else if (wsPort) { host = location.hostname + ':' + wsPort; proto = 'ws://'; }
    } catch (e) { /* yok say */ }
    if (!host) { MP.retryAt = performance.now() + 5000; return; }
    if (location.hostname === 'localhost' && location.port !== '33470' && location.port !== '5173') {
      let server = 'https://ahududu.fakeyol.com';
      try { server = localStorage.getItem('ahududu_server_url') || server; } catch (e) { /* yok say */ }
      host = server.replace(/^https?:\/\//, '').replace(/\/+$/, '');
      proto = server.indexOf('https') === 0 ? 'wss://' : 'ws://';
    }
    const url = proto + host + '/ws/' + MP.userId;
    let ws;
    try { ws = new WebSocket(url); } catch (e) { MP.retryAt = performance.now() + 5000; return; }
    this.ws = ws;
    ws.onopen = () => {
      NET.opened = true; NET.offlineTries = 0; MP.retryAt = 0;
      NET.json({ type: 'game_hello', game: GAME_ID });
      mpUiRefresh();
    };
    ws.onmessage = ev => { let d; try { d = JSON.parse(ev.data); } catch (e) { return; } mpOnPacket(d); };
    ws.onclose = () => {
      const was = NET.ws === ws;
      NET.opened = false;
      if (was) NET.ws = null;
      MP.partnerOn = false; MP.hasT = false;
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
  partnerOn: false, retryAt: 0, sentAt: -1e9, lastRxCarAt: 0, bootAt: 0,
  // partnerin arabası: T = ağdan gelen hedef, S = ekranda yumuşatılan kopya
  T: { x: 0, y: 0, z: 0, yaw: 0, spd: 0, gear: 1, acc: 0, s: 0, d: 0 },
  S: { x: 0, y: 0, z: 0, yaw: 0, spd: 0, gear: 1, acc: 0 },
  hasT: false, carReady: false, shown: false, seqRank: 0, helloAt: 0, lastRxHelloAt: 0,
  set: null, bodyObj: 0, wheelObj: [0, 0, 0, 0],
  paint: MP_PAINT
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

// ------------------- 3) PARTNER ARABASI (ayrı objeler) ---------------------
// ÖNEMLİ HATA (düzeltildi): eski sürüm kendi arabanın mesh listesini partnerin
// listesine taşıyıp ARDINDAN kendi listesini BOŞALTIYOR (`src.items.length = 0`)
// ve camları `CAR.glass.items.length = 0` ile siliyordu. Sonuç: kendi arabamız
// hiçbir şey çizmiyordu (arabayı bile görünmüyordu) ve partner arabası sadece
// ilk paket geldikten sonra ortaya çıkıyordu. Ayrıca partner paketleri oyuna hiç
// ulaşmadığı için pratikte ikisi de yoktu.
//
// Doğrusu: meshler PAYLAŞILIR (aynı vertex/index buffer'ları iki MeshSet'te
// birden kullanılabilir; hiçbir liste tüketilmez), yalnızca nesne yuvaları
// (slot) ayrıdır — bu sayede iki araba bağımsız hareket eder.
// Partner arabası yalnızca sevgili oyuna girdiğinde çizilir (R.drawables'a o an
// eklenir); önceden pistte duran bir "hayalet araba" yok.
function mpBuildPartnerCar() {
  if (MP.carReady) return true;
  try {
    if (typeof R === 'undefined' || typeof CAR === 'undefined' || !CAR.set || typeof objSlot !== 'function') return false;
    const shared = CAR.shared;
    if (!shared || !shared.body || !shared.wheels || shared.wheels.length < 4) return false;
    const fam = CAR.fam;
    if (!fam) return false;
    // gövde + 4 tekerlek için kendi yuvalarımız
    MP.bodyObj = objSlot();
    for (let i = 0; i < 4; i++) MP.wheelObj[i] = objSlot();
    const set = MP.set = new MeshSet(fam);
    // gövde (gölge dahil). Direksiyon simidi partnerin gövde yuvasına bağlanır:
    // ayrı bir yuva açıp hiç güncellemezsek son matrisiyle kalır ve boş görünür.
    const b = shared.body;
    set.add({ vb: b.vb, ib: b.ib, count: b.count, bounds: { c: [b.cx, b.cy, b.cz], r: b.r } }, MP.bodyObj, 7);
    if (shared.steer) set.add({ vb: shared.steer.vb, ib: shared.steer.ib, count: shared.steer.count, bounds: { c: [shared.steer.cx, shared.steer.cy, shared.steer.cz], r: shared.steer.r } }, MP.bodyObj, 3);
    for (let i = 0; i < 4; i++) {
      const w = shared.wheels[i];
      if (!w) continue;
      set.add({ vb: w.vb, ib: w.ib, count: w.count, bounds: { c: [w.cx, w.cy, w.cz], r: w.r } }, MP.wheelObj[i], 7);
    }
    // camlar: aynı meshler, partnerin gövdesine bağlı (kendi camlarımız da kalır)
    if (CAR.glass && CAR.glass.items && CAR.glass.items.length) {
      const gl = new GlassSet();
      for (const g of CAR.glass.items) gl.add_({ vb: g.vb, ib: g.ib, count: g.count }, MP.bodyObj);
      gl.bind = () => MP.bodyObj;
      MP.glass = gl;
    }
    // R.drawables listesine HENÜZ eklenmez: partner oyunda yokken çizilecek bir
    // şey yok. İlk "hello"/araba paketinde mpShowPartner() ekler.
    MP.carReady = true;
    return true;
  } catch (e) { console.warn('[uno-mp] partner arabası kurulamadı:', e); return false; }
}
// Partner pistte göründüğünde çizim listesine ekle, kaybolunca çıkar.
function mpShowPartner(on) {
  try {
    if (!MP.carReady) return;
    const add = !!on;
    if (add) {
      // Partner çizim listesinde YALNIZCA BİR KEZ olmalı; yoksa her turda bir
      // kez daha eklenir ve "kayboldu" sanılır (eskiden fresnel/normal
      // eşlemesinin sessizce çifte eklemesi pistte hayalet araba bırakıyordu).
      let k = 0;
      for (let i = 0; i < R.drawables.length; i++) if (R.drawables[i] === MP.set) k++;
      if (!k) R.drawables.push(MP.set);                 // kendi arabamızdan SONRA çizilir
      if (MP.glass && R.transparents.indexOf(MP.glass) < 0) R.transparents.push(MP.glass);
    } else {
      let i;
      while ((i = R.drawables.indexOf(MP.set)) >= 0) R.drawables.splice(i, 1);
      if (MP.glass) { let j; while ((j = R.transparents.indexOf(MP.glass)) >= 0) R.transparents.splice(j, 1); }
    }
  } catch (e) { /* yok say */ }
  MP.shown = !!on && MP.carReady;
}
// Kendi arabamızın rengini bir kez yazar (partnerin arabası farklı renkte olsun).
function mpPaintMine() {
  try {
    const P = objParams(CAR.slotBody);
    if (!P[1] && !P[2] && !P[3]) { P[1] = MP_MINE[0]; P[2] = MP_MINE[1]; P[3] = MP_MINE[2]; }
  } catch (e) { /* yok say */ }
}
// --- kare önbellekleri (her karede nesne oluşturmamak için) ---
const MPF = {
  g: m4(), t: m4(), w: m4()    // gövde zemini, ek dönme, tekerlek matrisi
};
// Kare başında: partnerin matrisleri yumuşatılıp dünyaya yazılır.
function mpBeginFrame() {
  if (!MP.carReady) return;
  if (!MP.hasT) { MP.set.on = false; return; }
  const S = MP.S, T = MP.T, g = MPF.g;
  // Son paketten bu yana geçen süre 50 ms'den (20 Hz) uzunsa aynı hızla
  // ilerlet; ekran 60 Hz olduğu için yoksa araba zıplayarak gider.
  const now = performance.now(), gap = Math.min((now - MP.lastRxCarAt) / 1000, 0.2);
  if (gap > 0.06 && T.spd) { S.x += Math.cos(T.yaw) * T.spd * gap * 0.5; S.z += Math.sin(T.yaw) * T.spd * gap * 0.5; }
  const k = 0.34, ky = 0.4;
  S.x += (T.x - S.x) * k; S.y += (T.y - S.y) * k; S.z += (T.z - S.z) * k;
  let dy = T.yaw - S.yaw; if (dy > PI) dy -= TAU; else if (dy < -PI) dy += TAU;
  S.yaw += dy * ky; S.spd += (T.spd - S.spd) * k; S.gear = T.gear; S.acc = T.acc;
  // gövde matrisi (kendi arabamızdaki kurulumla aynı: gövde zemin tabanlı)
  const c = Math.cos(S.yaw), s = Math.sin(S.yaw), ox = -(VP.L / 2 - VP.a);
  g[0] = c; g[1] = 0; g[2] = s; g[3] = 0;
  g[4] = 0; g[5] = 1; g[6] = 0; g[7] = 0;
  g[8] = -s; g[9] = 0; g[10] = c; g[11] = 0;
  g[12] = S.x + c * ox; g[13] = S.y; g[14] = S.z + s * ox; g[15] = 1;
  // gövde: zeminde 0.18 m yukarı (malzemenin gövde tabanı)
  m4ident(MPF.t); MPF.t[13] = 0.18;
  const BG = objModel(MP.bodyObj), BP = objPrev(MP.bodyObj);
  for (let i = 0; i < 16; i++) BP[i] = BG[i];        // önceki kare = mblur kaynağı
  m4mul(BG, g, MPF.t);
  // malzeme parametreleri: fren lambası, geri vites, farlar + partnerin rengi
  const P = objParams(MP.bodyObj);
  P[0] = S.acc < -0.05 ? 1 : 0; P[1] = S.gear === 0 ? 1 : 0; P[2] = 1;
  P[4] = MP.paint[0]; P[5] = MP.paint[1]; P[6] = MP.paint[2]; P[7] = 0;
  // tekerlekler: kendi arabamızla aynı yerleşim (CAR.hubs), dönme hızı hızdan
  const spin = S.spd / VP.R, blur = Math.abs(spin), w = MPF.w;
  for (let i = 0; i < 4; i++) {
    const h = CAR.hubs[i], left = (i & 1) === 0;
    const a = left ? PI : 0, ca = Math.cos(a), sa = Math.sin(a);
    const gi = left ? spin : -spin, cg = Math.cos(gi), sg = Math.sin(gi);
    w[0] = ca * cg; w[1] = sg; w[2] = -sa * cg; w[3] = 0;
    w[4] = -ca * sg; w[5] = cg; w[6] = sa * sg; w[7] = 0;
    w[8] = sa; w[9] = 0; w[10] = ca; w[11] = 0;
    w[12] = h[0]; w[13] = h[1]; w[14] = h[2]; w[15] = 1;
    const WM = objModel(MP.wheelObj[i]), WP = objPrev(MP.wheelObj[i]);
    for (let j = 0; j < 16; j++) WP[j] = WM[j];
    m4mul(WM, g, w);
    objParams(MP.wheelObj[i])[0] = blur;            // yuvarlanma bulanıklığı
  }
  MP.set.on = true;
}

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
      panner.panningModel = 'equalpower'; panner.distanceModel = 'linear';
      panner.refDistance = 6; panner.maxDistance = 60; panner.rolloffFactor = 0.6;
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
let _mpSndAt = 0;
function mpSoundFrame() {
  const C = MPSND.ctx;
  if (!C) return;
  // Ekolayzer güncellemeleri 60 Hz yerine 10 Hz: her karede setTargetAtTime
  // çağırmak ses iş parçacığını gereksiz yere meşgul ediyordu.
  const t0 = performance.now();
  if (t0 - _mpSndAt < 100) return;
  _mpSndAt = t0;
  if (C.state === 'suspended') C.resume().catch(() => {});
  if (!MP.hasT || !MP.partnerOn || typeof GS === 'undefined') { try { MPSND.gain.gain.value = 0; } catch (e) { } return; }
  const D = MP.S, dx = D.x - GS.cx, dz = D.z - GS.cz, dy = D.y - GS.cy;
  const dist = Math.sqrt(dx * dx + dz * dz + dy * dy);
  const muted = (typeof SND !== 'undefined' && SND.mute) ? 0 : 1;
  const vol = dist > 60 ? 0 : (1 - dist / 60) * (1 - dist / 60) * 0.5 * muted;
  const t = C.currentTime, sp = Math.abs(D.spd);
  try {
    MPSND.gain.gain.setTargetAtTime(vol, t, 0.12);
    const rpm = 850 + Math.min(sp, 45) * 175;
    MPSND.osc.frequency.setTargetAtTime(rpm / 30, t, 0.08);
    MPSND.osc2.frequency.setTargetAtTime(rpm / 60, t, 0.08);
    MPSND.filter.frequency.setTargetAtTime(420 + Math.min(sp, 45) * 70, t, 0.12);
    const c = Math.cos(GS.yaw), s = Math.sin(GS.yaw);
    const rx = dz * c - dx * s, fw = dx * c + dz * s;     // kameraya göre sağ/ön
    const p = MPSND.panner;
    if (!p) return;
    if (p.positionX) { p.positionX.value = rx; p.positionY.value = dy; p.positionZ.value = fw + 2; }
    else if (p.setPosition) p.setPosition(rx, dy, fw + 2);
    else if (p.pan) p.pan.value = Math.max(-1, Math.min(1, rx / 20));
  } catch (e) { /* yok say */ }
}

// ---------------------------- 5) MİKROFON ----------------------------------
// Bas-konuş: 16 kHz, 16-bit PCM parçaları (≈200 ms). Yalnızca partner varken
// görünen küçük düğmeyle açılır; kamera/mikrofon hiçbir zaman kendiliğinden
// başlamaz.
const MIC = { ctx: null, node: null, stream: null, timer: null, buf: [] };
function micTalk(on) {
  const say = document.querySelector('#mpSay .say');
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
  if (MIC.node) { try { MIC.node.disconnect(); } catch (e) { } MIC.node = null; }
  if (MIC.stream) { MIC.stream.getTracks().forEach(t => { try { t.stop(); } catch (e) { } }); MIC.stream = null; }
  if (MIC.ctx) { try { MIC.ctx.close(); } catch (e) { } MIC.ctx = null; }
  MIC.buf = [];
  const say = document.querySelector('#mpSay .say');
  if (say) say.textContent = '🎤 Basılı tut: konuş';
}
const MICPLAY = { ctx: null };
function mpPlayMic(b64) {
  try {
    if (!MICPLAY.ctx) { const AC = window.AudioContext || window.webkitAudioContext; MICPLAY.ctx = new AC(); }
    const ctx = MICPLAY.ctx;
    if (ctx.state === 'suspended') ctx.resume().catch(() => { });
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

// ---------------------------- 6) PAKETLER ----------------------------------
// d = [x, y, z, yaw, hız, vites, gaz/fren, s, d]
function mpSelfState() {
  const V = VEH;
  return [Math.round(V.x * 100) / 100, Math.round(V.y * 100) / 100, Math.round(V.z * 100) / 100,
    Math.round(V.yaw * 1000) / 1000, Math.round(Math.sqrt(V.vx * V.vx + V.vy * V.vy) * 100) / 100,
    V.gear | 0, (V.throttle - V.brake) >= 0 ? 1 : -1,
    Math.round(V.s * 10) / 10, Math.round(V.d * 10) / 10];
}
let _frameNo = 0;
function mpSendCar() {
  if (!NET.live) return;
  if ((++_frameNo % Math.max(1, Math.round(60 / MP_TICK_HZ))) !== 0) return;   // 20 Hz
  if (typeof UI !== 'undefined' && UI.st !== ST.JOGO && UI.st !== ST.FITA) return;
  NET.json({ type: 'game_car', d: mpSelfState() });
}
function mpOnCar(d) {
  if (!Array.isArray(d) || d.length < 5) return;
  const T = MP.T;
  const jump = !MP.hasT || Math.abs(T.x - d[0]) + Math.abs(T.z - d[2]) > 30;
  T.x = +d[0] || 0; T.y = +d[1] || 0; T.z = +d[2] || 0; T.yaw = +d[3] || 0;
  T.spd = +d[4] || 0; T.gear = +d[5] || 0; T.acc = +d[6] || 0; T.s = +d[7] || 0; T.d = +d[8] || 0;
  if (jump) { MP.S.x = T.x; MP.S.y = T.y; MP.S.z = T.z; MP.S.yaw = T.yaw; MP.S.spd = T.spd; MP.hasT = true; }
  if (!MP.partnerOn) { MP.partnerOn = true; mpShowPartner(true); mpUiRefresh(); }
  MP.lastRxCarAt = performance.now();
}
// Partner oyundan çıkınca: arabasını pistten kaldır (hedef/ekran kopyası temizlenir).
function mpPartnerGone() {
  MP.partnerOn = false; MP.hasT = false;
  mpShowPartner(false);
  if (typeof mpUiRefresh === 'function') mpUiRefresh();
}
function mpOnPacket(d) {
  if (!d || typeof d !== 'object') return;
  switch (d.type) {
    case 'game_hello':
      if (d.from === MP.userId) break;          // kendi yankımız — yok say
      if (MP._helloAnswered) MP.heardOurHello = true;   // karşı taraf bizim hello'muza yanıt verdi
      MP.partnerOn = true;
      MP.helloAt = performance.now(); MP.lastRxHelloAt = MP.helloAt;
      if (!MP.seqRankSent && typeof d.seq === 'number') MP.seqRank = d.seq === 0 ? 1 : 0;   // sıra tersine dönmesin
      mpShowPartner(true);                      // partner oyuna girdi: pistte görünür
      if (!MP.sentAt || MP.sentAt < 0) MP.sentAt = 0;
      // Karşı taraf bizi tanısın diye (yalnızca bizim hello'muza karşılık
      // gelmediyse) kendimizi tanıt ve nerede olduğumuzu söyle.
      if (typeof NET !== 'undefined' && NET.live && !MP._helloAnswered) {
        MP._helloAnswered = true;
        NET.json({ type: 'game_hello', game: GAME_ID, from: MP.userId, seq: MP.seqRank });
        NET.json({ type: 'game_car', d: mpSelfState() });   // partnerimiz bizi hemen görsün
      }
      mpUiRefresh();
      break;
    case 'game_car': mpOnCar(d.d); break;
    case 'game_bye':
      if (!d.from || d.from !== MP.userId) mpPartnerGone();   // kendi çıkışımız bize yansımasın
      break;
    case 'game_countdown': mpOnCountdown(d); break;
    case 'game_start': mpOnStart(d); break;
    case 'game_mic':
      if (typeof d.data === 'string') mpPlayMic(d.data);
      break;
  }
}
// Menüdeki durum yazısı: teknik detay yok, sade cümle.
function mpUiRefresh() {
  const st = document.getElementById('mpStat');
  if (st) st.textContent = MP.partnerOn
    ? MP.partnerName + ' oyunda · arabası pistte'
    : 'tek başına sürüyorsun';
  const say = document.getElementById('mpSay');
  if (say) say.style.display = MP.partnerOn ? 'block' : 'none';
}

// ---------------------------- 7) EŞZAMANLI BAŞLANGIÇ -----------------------
// İki telefonda da "Başla"ya basılınca oyun YEREL olarak beklemeden başlarsa
// start çizgisinden birkaç saniye farkla kalkılır ve tur süreleri
// karşılaştırılamaz. Bu bölüm ortak bir başlangıç saati kurar:
//   • "Başla"ya basan, diğerine game_countdown gönderir (3 saniyelik geri sayım),
//   • geri sayım bitince yerel saatte T0 = now + 3 sn (her iki tarafta eşit),
//   • game_start T0'ı taşır; iki uç da aynı mutlak saate göre devam eder.
const MPSTART = { at: 0, pending: false, timer: null, cdEnd: 0, cdStart: 0 };
function mpUptime() { return performance.timeOrigin + performance.now(); }
function mpServerOffset(at) {
  // gönderen tarafın saati ile bizimki arasındaki farkı ağ gecikmesi kadar
  // ("tek yön" ~= (güncel görünen gidiş dönüş / 2)) eşitle
  const now = mpUptime(), skew = (at - now) - (MP.clock.midLag || 0);
  if (MP.clock.offset === 0 || Math.abs(skew) > 2000) MP.clock.offset = skew;
  return skew;
}
MP.clock = { offset: 0, midLag: 0 };
function mpLocalFromServer(at) { return at - MP.clock.offset; }
function mpArmStart() {
  // yerel geri sayım çizildi mi ve bitti mi?
  if (!MPSTART.pending) return;
  if (mpUptime() < MPSTART.at) return;
  MPSTART.pending = false;
  try { uiDrive(); } catch (e) { console.warn('[uno-mp] yarış başlatılamadı', e); }
}
function mpOnCountdown(d) {
  const at = +d.at || 0;
  if (!at) return;
  mpServerOffset(at);
  const local = mpLocalFromServer(at);
  if (local <= mpUptime()) { mpOnStart(d); return; }
  MPSTART.at = local; MPSTART.pending = true;
  mpUiRefresh();
}
function mpOnStart(d) {
  const at = +d.at || 0;
  if (at) mpServerOffset(at);
  if (at) MPSTART.at = mpLocalFromServer(at);
  mpArmStart();
}
// "Başla" düğmesi oyunda basıldığında 52_ui.js tarafından çağrılır.
// Dönüş: true = geri sayım kuruldu (oyun beklemeli), false = kurulamadı.
function mpAnnounceStart() {
  if (!NET.live) { MPSTART.pending = false; return false; }
  const at = mpUptime() + MP_COUNTDOWN * 1000 + 400;    // paketin gidişi için pay
  NET.json({ type: 'game_countdown', game: GAME_ID, at: Math.round(at), from: MP.userId });
  MPSTART.at = mpLocalFromServer(at);
  MPSTART.pending = true;
  return true;
}

// ---------------------------- 8) DÖNGÜ KANCALARI ---------------------------
// SPAWN: partner oyuna girdiğinde ARABASI HARİTADA belirir (ilk paket bu
// konumu taşır). Paketten önce kendi konumumuzun yanına bir "hayalet" koymak
// yanlıştı: partner pistte olmasa bile onun arabası görünüyordu. Bu yüzden
// seed yalnızca hâlâ ilk paket bekleniyorsa ve partner gerçekten oyundaysa,
// ilk "hello"dan sonra kısa bir an için devreye girer.
// Başlangıç sıralaması: iki araba aynı yerde doğmasın diye geri sayım
// başlamadan önce (start çizgisinde) sıra verilir; ilk hello'daki sıra
// bilgisi (seq) hangi arabanın önde duracağını belirler.
function mpSeedPartnerAtGrid() {
  if (MP.hasT || !MP.carReady || typeof VEH === 'undefined') return;
  try {
    const V = VEH, T = MP.T;
    // partner bir sıra arkada/önde durur; aynı noktaya iki araba binmez
    const back = (MP.seqRank || 0) === 0 ? -5.2 : 5.2;      // kendi yönümüze göre geri/ileri
    const c = Math.cos(V.yaw), s = Math.sin(V.yaw);
    T.x = MP.S.x = V.x + c * back; T.z = MP.S.z = V.z + s * back;
    T.y = MP.S.y = V.y; T.yaw = MP.S.yaw = V.yaw;
    T.spd = MP.S.spd = 0; MP.hasT = true;
    mpBeginFrame();
  } catch (e) { /* yok say */ }
}
// Bağlantı kurulduğunda: kendimizi tanıt ve nerede olduğumuzu bildir; sevgili
// de oyundaysa arabası HARİTADA belirir (game_hello -> mpShowPartner).
function mpAnnounce() {
  if (typeof NET === 'undefined' || !NET.live) return;
  MP.seqRankSent = true;
  NET.json({ type: 'game_hello', game: GAME_ID, from: MP.userId, seq: MP.seqRank });
  if (typeof VEH !== 'undefined') NET.json({ type: 'game_car', d: mpSelfState() });
}
function mpNetHousekeeping() {
  const now = performance.now();
  // ilk "hello"dan sonra 0,25 s içinde araba paketi gelmezse partner kendi
  // menüsündedir: onu hemen kaybolmuş saymayız, yalnızca temsilî bir yerde
  // gösterilir (paket gelince gerçek konumuna oturur).
  if (MP.partnerOn && !MP.hasT && MP.helloAt && now - MP.helloAt > 250) mpSeedPartnerAtGrid();
  if (!NET.opened && MP.retryAt && now >= MP.retryAt) { MP.retryAt = 0; NET.connect(); }
  // partner uzun süre paket göndermediyse pistten kalksın (15 sn)
  if (MP.partnerOn && now - Math.max(MP.lastRxCarAt, MP.lastRxHelloAt, MP.helloAt || 0) > 15000) {
    mpPartnerGone();
  }
  if (MPSTART.pending) mpArmStart();
}

function mpBoot() {
  mpResolveUser();
  MP.bootAt = performance.now();
  mpSoundInit();
  mpBuildPartnerCar();
  mpPaintMine();
  MP.seqRank = MP.userId === 'murat' ? 0 : 1;     // sıra: murat önde, selin arkada
  // Kabuktan gelen partner paketleri (önceden hiç bağlanmamıştı: partnerin
  // arabası ve geri sayım hiç ulaşmıyordu).
  try { if (MPSHARE && MPSHARE.on) MPSHARE.on((d) => mpOnPacket(d)); } catch (e) { /* yok say */ }
  // Bağlantı durumu: kabuk soketi açılırsa oyunun kendi soketi kapatılır (tek
  // bağlantı); kabuk düşerse kendi yedeğimiz açılır.
  try {
    if (MPSHARE && typeof MPSHARE.onState === 'function') MPSHARE.onState((open) => {
      if (open) {
        if (NET.ws) { NET.close(); }
        NET.opened = false;
        MP.retryAt = 0;
        mpAnnounce();                                     // yeni bağlantıda kendimizi tanıt
      } else if (!NET.ws) {
        NET.closedByUser = false; MP.retryAt = 0;
        NET._probed = true;                                 // artık köprü yanıt vermiyor
        NET._openOwn();
      }
      mpUiRefresh();
    });
  } catch (e) { /* yok say */ }
  NET.connect();
  setTimeout(() => { try { mpAnnounce(); } catch (e) { /* yok say */ } }, 1200);
  if (typeof window !== 'undefined') {
    // oyun kapanırken partner pistten kalksın (sayfa kapanırken paket yarışı)
    addEventListener('pagehide', () => { try { if (NET.live) NET.json({ type: 'game_bye', from: MP.userId }); } catch (e) { /* yok say */ } });
  }
  mpUiRefresh();
}
BUILD.push(async () => { try { mpBuildPartnerCar(); } catch (e) { } try { mpBoot(); } catch (e) { console.warn('[uno-mp] başlatılamadı', e); } });
// Teşhis: konsoldan window.__mp ile çok oyunculu durumu inceleyebilirsin
// (otomatik testler de paket işleyicisini buradan sürer: tests/test_game_logic.py)
try {
  window.__mp = {
    net: NET, mp: MP, snd: MPSND,
    packet: (d) => mpOnPacket(d),
    show: (on) => mpShowPartner(on),
    gone: () => mpPartnerGone(),
    src: { show: mpShowPartner.toString(), bye: mpPartnerGone.toString() },
    carInfo: () => ({ ownItems: CAR.set.items.length, ownGlass: CAR.glass ? CAR.glass.items.length : 0, partnerItems: MP.set ? MP.set.items.length : -1, carReady: MP.carReady, shown: R.drawables.indexOf(MP.set) >= 0 }),
    state() {
      return {
        userId: MP.userId, partnerName: MP.partnerName,
        wsOpen: NET.opened || (MPSHARE ? MPSHARE.open() : false), wsState: NET.ws ? NET.ws.readyState : -1,
        viaShell: !!(MPSHARE && MPSHARE.open()),
        partnerOn: MP.partnerOn, partnerCar: MP.carReady, hasPartnerPos: MP.hasT,
        partner: { x: +(MP.S.x || 0).toFixed(1), z: +(MP.S.z || 0).toFixed(1) },
        me: { x: +(VEH.x || 0).toFixed(1), z: +(VEH.z || 0).toFixed(1) }
      };
    }
  };
} catch (e) { /* yok say */ }
