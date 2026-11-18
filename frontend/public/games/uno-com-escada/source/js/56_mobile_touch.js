// ============================================================================
// MOBİL: yatay ekran + dokunmatik kumanda (Fable 5.2 sürümüne eklendi)
// ----------------------------------------------------------------------------
//   1) YÖN     : oyun açılınca yatay (landscape) kilidi istenir. Telefon yatay
//                değilse "telefonu yan çevir" ekranı gösterilir (görüntüyü CSS
//                ile 90° çevirmek yerine: o yol HUD'u ve düğmeleri bozuyordu).
//   2) DOKUNMA : ekrana gaz/fren/direksiyon/el freni/kamera düğmeleri konur.
//                Düğmeler oyunun KENDİ tuş bitlerini (K_W, K_S, ...) yazar;
//                fizik kodu değişmez.
//   3) BOYUT   : yön değişince çizim hedefleri yeniden kurulur (rendererResize);
//                yoksa yatayda görüntü geriliyor ve kamera gökyüzünü gösteriyordu.
// ----------------------------------------------------------------------------

const MOB = {
  touch: false,
  keys: 0,          // basılı dokunma tuşları
  wsHeld: 0,        // klavye tuşları (aynı anda tutulabilir)
  locked: false,
  lastW: 0, lastH: 0,
  ready: false,     // oyun sahnesi kuruldu mu (resize ancak ondan sonra)
  pending: false
};

function mobIsTouch() {
  try {
    return (navigator.maxTouchPoints || 0) > 0 ||
      /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  } catch (e) { return false; }
}
function mobIsPortrait() { return innerHeight > innerWidth; }

// ---------------------------- 1) YÖN KİLİDİ ---------------------------------
function mobLockLandscape() {
  try {
    const so = screen.orientation;
    if (so && so.lock) {
      so.lock('landscape').then(() => { MOB.locked = true; mobSync(); })
        .catch(() => { MOB.locked = false; mobSync(); });
    }
  } catch (e) { /* desteklenmiyor */ }
  mobSync();
}

// Yatay değilse "çevir" ekranı; yataysa oyunu göster
function mobSync() {
  const need = MOB.touch && mobIsPortrait();
  const ov = document.getElementById('mobrotate');
  if (ov) ov.style.display = need ? 'flex' : 'none';
  // dikeyde oyunu duraklat (araba boşta ilerlemesin)
  if (need && typeof uiPause === 'function' && typeof ST !== 'undefined' && UI.st === ST.JOGO) {
    try { uiPause(); } catch (e) { /* yok say */ }
  }
  mobResize();
}

// ---------------------------- 2) BOYUT -------------------------------------
// Yön değişince çizim hedeflerini yeniden kur. Sahne henüz kurulmadıysa istek
// saklanır ve main() bittiğinde uygulanır. Boyut screenSize() ile hesaplanır:
// mobilitte uzun kenar sınırlıdır (bkz. 01_gpu.js) — eskiden burada DPR 2 ile
// tam ekran çözünürlüğü isteniyordu ve GPU belleği yetmiyordu.
function mobResize() {
  if (typeof G === 'undefined' || !G.dev) return;
  if (typeof screenSize !== 'function') return;
  const s = screenSize(), W = s[0], H = s[1];
  if (W === MOB.lastW && H === MOB.lastH) return;
  MOB.lastW = W; MOB.lastH = H;
  if (!MOB.ready || typeof rendererResize !== 'function') { MOB.pending = true; return; }
  try {
    rendererResize(W, H);
    if (typeof hudLayout === 'function') hudLayout();
  } catch (e) { console.warn('[mob] yeniden boyutlandırma:', e); }
}

// ------------------------ 3) DOKUNMATİK KUMANDA ----------------------------
function mobSetKey(bit, on) {
  if (on) MOB.keys |= bit; else MOB.keys &= ~bit;
  mobApplyKeys();
}
// gameRestart() GS.held'i sıfırlar; basılı düğmeler her adımda yeniden uygulanır.
function mobApplyKeys() {
  if (typeof GS === 'undefined' || !MOB.touch) return;
  const want = MOB.wsHeld | MOB.keys;
  if (GS.held !== want) GS.held = want;
}

const MOB_BTN = [
  { id: 'gas', bit: () => K_W, icon: '▲', label: 'GAZ', side: 'right', size: 'big' },
  { id: 'brake', bit: () => K_S, icon: '▼', label: 'FREN', side: 'right', size: 'mid' },
  { id: 'left', bit: () => K_A, icon: '◀', label: 'SOL', side: 'left', size: 'mid' },
  { id: 'right', bit: () => K_D, icon: '▶', label: 'SAĞ', side: 'left', size: 'mid', extra: 't-right2' },
  { id: 'hand', bit: () => K_SPACE, icon: '✋', label: 'EL FRENİ', side: 'left', size: 'small' },
  { id: 'cam', bit: () => K_C, icon: '🎥', label: 'KAMERA', side: 'left', size: 'small', tap: true },
  { id: 'reset', bit: () => K_R, icon: '↺', label: 'PİSTE DÖN', side: 'right', size: 'small', tap: true }
];

function mobBuildControls() {
  if (document.getElementById('touchui')) return;
  const wrap = document.createElement('div');
  wrap.id = 'touchui';

  for (const b of MOB_BTN) {
    const el = document.createElement('button');
    el.className = 'tbtn t-' + b.side + ' t-' + b.size + ' t-' + b.id + (b.extra ? ' ' + b.extra : '');
    el.type = 'button';
    el.innerHTML = '<span class="ic">' + b.icon + '</span><span class="lb">' + b.label + '</span>';
    if (b.tap) {
      el.addEventListener('pointerdown', ev => {
        ev.preventDefault();
        const code = b.bit();
        mobSetKey(code, true);
        el.classList.add('on');
        setTimeout(() => { mobSetKey(code, false); el.classList.remove('on'); }, 90);
      });
    } else {
      const press = ev => { ev.preventDefault(); el.classList.add('on'); mobSetKey(b.bit(), true); };
      const release = ev => { if (ev) ev.preventDefault(); el.classList.remove('on'); mobSetKey(b.bit(), false); };
      el.addEventListener('pointerdown', press);
      el.addEventListener('pointerup', release);
      el.addEventListener('pointercancel', release);
      el.addEventListener('pointerleave', ev => { if (el.classList.contains('on')) release(ev); });
      el.addEventListener('lostpointercapture', release);
    }
    wrap.appendChild(el);
  }
  document.body.appendChild(wrap);
}

// "Telefonu yan çevir" ekranı
function mobBuildRotateOverlay() {
  if (document.getElementById('mobrotate')) return;
  const ov = document.createElement('div');
  ov.id = 'mobrotate';
  ov.innerHTML = '<div class="ph">📱</div><b>Telefonu yan çevir</b>' +
    '<span>Oyun yatay ekranda oynanıyor.<br>Sürüklerken oyun duraklatıldı.</span>' +
    '<button type="button" class="force">Yine de dikey oyna</button>';
  ov.querySelector('.force').addEventListener('click', () => {
    MOB.forcePortrait = true;
    ov.style.display = 'none';
  });
  document.body.appendChild(ov);
}

function mobHookKeyboard() {
  try {
    addEventListener('keydown', e => { const k = KEYMAP[e.code]; if (k) MOB.wsHeld |= k; }, true);
    addEventListener('keyup', e => { const k = KEYMAP[e.code]; if (k) MOB.wsHeld &= ~k; }, true);
    addEventListener('blur', () => { MOB.wsHeld = 0; MOB.keys = 0; if (typeof GS !== 'undefined') GS.held = 0; });
  } catch (e) { /* yok say */ }
}

// Arkadaşının motorunu duyabilmek için ses bağlamını ilk dokunuşta aç
// (tarayıcı/WebView kuralları: kullanıcı hareketi olmadan ses başlamaz).
function mobUnlockAudio() {
  try { if (typeof mpSoundInit === 'function') mpSoundInit(); } catch (e) { /* yok say */ }
  const C = window.__mp && window.__mp.snd && window.__mp.snd.ctx;
  if (C && C.state === 'suspended') C.resume().catch(() => { });
}

function mobBoot() {
  MOB.touch = mobIsTouch();
  if (MOB.touch) {
    mobBuildControls();
    mobBuildRotateOverlay();
    mobHookKeyboard();
    document.body.classList.add('has-touch');
    mobLockLandscape();
  }
  addEventListener('resize', () => mobSync());
  addEventListener('orientationchange', () => setTimeout(mobSync, 250));
  // Tam ekran: iframe içinde tek dokunuşla tam ekrana geçilemez; üstteki
  // Ahududu kabuğu (GamePlayer) oyun açılırken bunu kendisi yapıyor. Yine de
  // kullanıcı bir yere dokunduğunda tarayıcı tam ekranına izin veriliyorsa
  // denenir (hata sessizce yutulur).
  if (MOB.touch) {
    const once = () => { mobUnlockAudio(); mobTryFullscreen(); removeEventListener('pointerdown', once); };
    addEventListener('pointerdown', once, { passive: true });
  }
}
// Telefonda tarayıcı çubuklarını da gizlemek için tam ekran dene (yalnızca
// kullanıcı hareketiyle; iOS Safari desteklemiyor, sorun değil — iframe zaten
// tam ekran boyutunda). Ahududu kabuğunun içindeyken tam ekranı kabuk yapar:
// oyun iframe'inin kendisi tam ekran isteyemez, bu yüzden köprüye sorulur.
function mobTryFullscreen() {
  try {
    if (typeof MPSHARE !== 'undefined' && MPSHARE && MPSHARE.present && MPSHARE.present()) {
      if (MPSHARE.fullscreen) MPSHARE.fullscreen();
      return;
    }
    if (document.fullscreenElement) return;
    const el = document.documentElement;
    const r = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!r) return;
    const p = r.call(el, { navigationUI: 'hide' });
    if (p && p.catch) p.catch(() => { });
    // tam ekranda yatay kilidi tekrar dene
    setTimeout(mobLockLandscape, 300);
  } catch (e) { /* yok say */ }
}

// Sahne kurulduktan sonra ölçümü uygula ve yön ekranını tazele
function mobAfterScene() {
  MOB.ready = true;
  if (MOB.pending) { MOB.pending = false; MOB.lastW = 0; }
  mobResize();
  mobSync();
}

BUILD.push(async () => {
  try { mobBoot(); } catch (e) { console.warn('[mob] başlatılamadı', e); }
  try { mobAfterScene(); } catch (e) { console.warn('[mob] sahne sonrası:', e); }
});

// Teşhis: konsoldan window.__diag ile bakılabilir
try {
  window.__mob = MOB;
  window.__diag = {
    keys() { return { held: GS.held, touch: MOB.keys, ws: MOB.wsHeld, tick60: GS.tick60 }; },
    car() { return { x: +VEH.x.toFixed(2), vx: +VEH.vx.toFixed(2), speed: +Math.sqrt(VEH.vx * VEH.vx + VEH.vy * VEH.vy).toFixed(2), steer: +VEH.steer.toFixed(3) }; },
    view() { return { W: G.W, H: G.H, cw: G.canvas ? G.canvas.width : -1, ch: G.canvas ? G.canvas.height : -1, ratio: +(G.W / G.H).toFixed(3), portrait: mobIsPortrait(), overlay: !!(document.getElementById('mobrotate') && document.getElementById('mobrotate').style.display !== 'none') }; },
    lights() { const s = []; for (const [k, b] of [['K_W', K_W], ['K_S', K_S], ['K_A', K_A], ['K_D', K_D], ['K_SPACE', K_SPACE]]) if (GS.held & b) s.push(k); return s; },
    cam() { return { pos: Array.from(R.cam.pos), fov: +R.cam.fovy.toFixed(3) }; }
  };
} catch (e) { /* yok say */ }
