// ============================================================================
// UYARLANABİLİR PERFORMANS — telefonda düşük FPS'e karşı otomatik önlemler
// ----------------------------------------------------------------------------
// Sorun: oyun telefonda uzun kenarı 1600 piksele kadar çiziyor, 3 katman gölge
// + 2 küp harita yüzü + TAA + hareket bulanıklığı + tam kalite çim ve ağaç
// çalıştırıyor. Güçlü bir masaüstünde sorun değil; orta seviye bir telefonda
// kare başına 30-50 ms demek (20-30 FPS).
//
// Çözüm üç katmanlı:
//   1) KARE TEMPOSU: ekran 90/120 Hz olsa da oyun 60 FPS'ye kilitlenir
//      (GAME.minFrameMs). GPU'yu boşuna iki kat doldurmak telefonda ısı ve
//      pil demekti; kare bütçesi de ikiye katlanır → FPS düşmez.
//   2) OTURUM İÇİ ÖLÇEK: son 90 karenin medyan süresine bakılır. 21 ms'in
//      üstündeyse çizim çözünürlüğü bir kademe (×0.82) düşürülür, 15 ms'in
//      altına inip uzun süre orada kalırsa bir kademe geri alınır. Hedeflenen
//      aralık 16-21 ms (≈48-60 FPS). Ölçek localStorage'da saklanır: bir
//      sonraki açılış düşük çözünürlükle başlar (ısınma/açılış düşüşü olmaz).
//   3) YAPISAL HAFİFLETME: çözünürlük en dibe indiyse ve kare hâlâ yavaşsa
//      pahalı sistemler tek tek kapanır: yansıma haritası seyreltilir →
//      gölge katman sayısı 3'ten 2'ye → bitki örtüsü menzili kısalır.
//      (Hareket bulanıklığı telefonda BAŞTAN kapalıdır: bkz. 20_renderer.js.)
//
// Hiçbir şey zorla "grafikler çirkin" olmaya başlamaz: kararlar ölçüme dayanır
// ve masaüstünde (?detay=1 ya da dokunmatik olmayan) hiç uygulanmaz.
// ?sabit=1 ile otomatik ayar kapatılabilir (teşhis/ölçüm için).
// ============================================================================
const AUTOP = {
  on: false, step: 0,            // 0..SMAX çözünürlük kademesi
  hist: new Float32Array(90), hn: 0, hIdx: 0, last: 0, cooldown: 0,
  base: 1,                       // başlangıç ölçeği (kaydedilmiş)
  structural: 0,                 // 0 yok, 1 mb kapat, 2 küp seyrelt, 3 gölge azalt
  reasons: [], fps: 0, median: 0
};
const AUTOP_SMAX = 3;            // en alt kademe: 0.56 kat
const AUTOP_LEVELS = [1, 0.82, 0.68, 0.56];

function autopInit() {
  // Dokunmatik cihazlar (telefon/tablet) ve mobil algılanan cihazlar: canlı
  // oyun (menü/capture/ölçüm değil), otomatik ayar açık.
  if (typeof G === 'undefined') return;
  const touch = (() => { try { return (navigator.maxTouchPoints || 0) > 0; } catch (e) { return false; } })();
  if (!G.mobile && !touch) return;
  if (typeof Q !== 'undefined' && (Q.has('sabit') || Q.has('res') || Q.has('cap') || Q.has('scene'))) return;
  AUTOP.on = true;
  // 1) kare temposu: 60 FPS'ye kilitle (ekran 120 Hz olsa da)
  if (typeof GAME !== 'undefined' && !(GAME.minFrameMs > 0)) GAME.minFrameMs = 14.6;
  applyAutopScale(G.resScale || 1, true);
}

// Kaydedilmiş/yeni ölçeği uygula. İlk kurulumda hedefler henüz yoktur:
// sadece değer saklanır, ilk rendererInit doğru boyutta kurulur.
function applyAutopScale(s, initial) {
  G.resScale = s;
  if (initial) return;
  resScaleSet(s);
  const sz = screenSize();
  try { if (typeof rendererResize === 'function') rendererResize(sz[0], sz[1]); } catch (e) { console.warn('[autop] yeniden boyut:', e); }
}

function autopFrame(t) {
  if (!AUTOP.on) return;
  const now = t;
  if (!AUTOP.last) { AUTOP.last = now; return; }
  const dt = now - AUTOP.last;
  AUTOP.last = now;
  if (dt > 300 || dt <= 0) return;             // sekme arka planda / kare atlandı
  AUTOP.hist[AUTOP.hIdx] = dt;
  AUTOP.hIdx = (AUTOP.hIdx + 1) % AUTOP.hist.length;
  if (AUTOP.hn < AUTOP.hist.length) AUTOP.hn++;
  if (AUTOP.hn < AUTOP.hist.length) return;
  // medyan: tempo sapmalarına karşı ortalama değil medyan kullanılır
  const a = Array.prototype.slice.call(AUTOP.hist);
  a.sort((p, q) => p - q);
  const med = a[a.length >> 1];
  AUTOP.median = med; AUTOP.fps = 1000 / med;
  if (now < AUTOP.cooldown) return;
  // 21 ms üstü: kare bütçesi aşılıyor → hafiflet
  if (med > 21) {
    if (AUTOP.step < AUTOP_SMAX) {
      AUTOP.step++;
      applyAutopScale(AUTOP_LEVELS[AUTOP.step], false);
      AUTOP.reasons.push('ölçek ' + AUTOP_LEVELS[AUTOP.step].toFixed(2) + ' (' + Math.round(med) + ' ms)');
      AUTOP.hn = 0; AUTOP.hIdx = 0;
      AUTOP.cooldown = now + 4000;
      return;
    }
    if (AUTOP.structural < 3) { autopLoosen(); AUTOP.cooldown = now + 2500; return; }
  }
  // uzun süre 15 ms altı: kaliteyi bir kademe geri ver
  if (med < 15 && AUTOP.step > 0) {
    if (AUTOP.structural > 0) { autopTighten(); AUTOP.cooldown = now + 6000; return; }
    AUTOP.step--;
    applyAutopScale(AUTOP_LEVELS[AUTOP.step], false);
    AUTOP.reasons.push('ölçek geri ' + AUTOP_LEVELS[AUTOP.step].toFixed(2));
    AUTOP.hn = 0; AUTOP.hIdx = 0;
    AUTOP.cooldown = now + 15000;               // osilasyon olmasın
  }
}

// yapısal hafifletme: pahalı sistemleri sırayla kapat
function autopLoosen() {
  AUTOP.structural++;
  try {
    if (AUTOP.structural === 1) {
      // Yansıma haritası (küp) her 3 karede bir güncellensin: kare başına
      // 2 yüz → ~0.7 yüz. İlk en ucuz kazanç.
      R.cubeEveryN = 3;
      AUTOP.reasons.push('yansıma seyrek');
    } else if (AUTOP.structural === 2) {
      // Gölge: 3 katman yerine 2 katman çizilir (en uzak katman donar).
      R.shadowCascades = 2;
      AUTOP.reasons.push('gölge 2 katman');
    } else if (AUTOP.structural === 3) {
      // Ağaç malzeme menzili ve çim menzili daha da kısalır.
      if (typeof VEG !== 'undefined' && VEG.mobileS) VEG.mobileS = 0.62;
      if (typeof GRASS !== 'undefined' && GRASS.mobileRange) GRASS.mobileRange = 0.6;
      AUTOP.reasons.push('bitki örtüsü menzili kısa');
    }
  } catch (e) { /* yok say */ }
}
function autopTighten() {
  AUTOP.structural--;
  try {
    if (AUTOP.structural === 2) { if (typeof GRASS !== 'undefined' && GRASS.mobileRange) GRASS.mobileRange = 0.78; if (typeof VEG !== 'undefined' && VEG.mobileS) VEG.mobileS = 0.8; AUTOP.reasons.push('bitki menzili normal'); }
    else if (AUTOP.structural === 1) { R.shadowCascades = 3; AUTOP.reasons.push('gölge 3 katman'); }
    else if (AUTOP.structural === 0) { R.cubeEveryN = 1; AUTOP.reasons.push('yansıma sık'); }
  } catch (e) { /* yok say */ }
}

// Teşhis: konsoldan window.__perf() ile bakılabilir
try {
  window.__perf = () => ({
    auto: AUTOP.on, fps: Math.round(AUTOP.fps), ms: Math.round(AUTOP.median),
    scale: +((G.resScale || 1).toFixed(2)), step: AUTOP.step, structural: AUTOP.structural,
    W: G.W, H: G.H, minFrameMs: GAME.minFrameMs, reasons: AUTOP.reasons.slice(-8)
  });
} catch (e) { /* yok say */ }
