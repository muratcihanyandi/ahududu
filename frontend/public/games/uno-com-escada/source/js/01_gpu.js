// Dispositivo WebGPU, utilitários de recurso e pré-processador de WGSL.
const Q = new URLSearchParams(location.search);
const BUILD = [];           // construtores de cena registrados pelos outros arquivos: async fn(), executados em ordem por main()
const GAME = { ready: false, mode: Q.get('scene') || 'game', capture: Q.has('cap'), tick: null, init: null, minFrameMs: 0, gpuWorstMs: 0, ui: false };
// Jogo aberto por uma pessoa (tela de início, painel, som) × ferramenta (captura, poses, teste, medição): as ferramentas de
// trabalho/ usam ?cap, ?perf, ?replay ou rodam num navegador automatizado, e para elas nada muda — sem menu, sem painel.
// ?ui=1 força o jogo completo (é como os testes de menu, entrada e som o abrem); ?ui=0 força o modo de ferramenta.
GAME.ui = Q.has('ui') ? Q.get('ui') !== '0' : !(Q.has('cap') || Q.has('perf') || Q.has('replay') || Q.has('auto') || Q.has('scene') || navigator.webdriver);
// Tempo em vetor tipado (escrita por quadro sem caixa na heap): RT[0] = tempo acumulado (s), RT[1] = dt do quadro renderizado, RT[2] = dt pedido ao jogo
const RT = new Float64Array([0, 1 / 60, 1 / 60, 0]);   // RT[3] = intervalo real do último quadro (ms), para as estatísticas
const G = {
  dev: null, ctx: null, fmt: 'bgra8unorm', W: 0, H: 0, hasTS: false, hasF32Filter: true, canvas: null, memMB: 0,
  // Mobil algısı BURADA yapılır, gpuInit() içinde değil: 20_renderer.js sabit
  // dokuların boyutunu (SHADOW_RES, SKY_W...) dosya yüklenirken hesaplıyor ve
  // gpuInit() daha sonra (main içinde) çalışıyor. Önce false kalıyordu, bu
  // yüzden telefonda 4096² gölge + 4096×1024 gökyüzü kuruluyordu.
  mobile: !Q.has('detay') && !Q.has('res') && gpuIsMobile()
};
// Telefonda uyarlanabilir çözünürlük açık (son çare cihaz kaybı hariç).
if (G.mobile) G.resScale = resScaleSaved();

// ---------------------------------------------------------------------------
// MOBİL GPU BÜTÇESİ (siyah ekranın asıl sebebi)
// ---------------------------------------------------------------------------
// Hedef dokular ekran çözünürlüğündedir. Telefonda (DPR 2, ~2340×1080) bu
// 4680×2160 demek: yalnızca ara hedefler 5 × 77 MB tutuyor ve toplam GPU
// dokusu ~1 GB'a çıkıyordu. Mobil GPU'ların belleği bu kadarına yetmediği
// için cihaz düşüyor (device lost / uncaptured error) ve oyun hiçbir şey
// çizmiyordu: ekranda yalnızca HTML düğmeleri kalıyordu.
// Çözüm: çizim çözünürlüğünü uzun kenarla ~1600 pikselde sınırla ve gölge /
// gökyüzü / ortam haritalarını da küçült. Görüntü bulanıklaşmasın diye
// yalnızca GPU'su zorlanan (mobil) cihazlarda uygulanır; ?res=WxH ve ?detay=1
// ile yine tam kaliteye dönülebilir.
const MOBILE_MAX_LONG = 1600;
// Uyarlanabilir çözünürlük: telefonda çözünürlük kare süresine göre ölçeklenir
// (bkz. 58_perf_auto.js). ?res=WxH ile ya da ?detay=1 ile sabitlenir.
const RES_SCALE_KEY = 'uno-res-scale';
function resScaleSaved() {
  try { const v = +localStorage.getItem(RES_SCALE_KEY); return v >= 0.5 && v <= 1.2 ? v : 1; } catch (e) { return 1; }
}
function resScaleSet(v) { try { localStorage.setItem(RES_SCALE_KEY, String(v.toFixed(2))); } catch (e) { /* yok say */ } }
// Mobil mi? UA her zaman güvenilir değil (uygulama içi WebView'de değiştirilen
// UA, masaüstü testleri). Bu yüzden dokunmatik + ekran boyu da bakılır: bir
// dokunmatik cihazda 720p'yi aşan DPR-ölçekli ekran, mobil GPU bütçesi isteyen
// bir cihaz demektir.
function gpuIsMobile() {
  try {
    const ua = navigator.userAgent || '';
    if (/Android|iPhone|iPad|iPod|Mobile|Tablet|Silk/i.test(ua)) return true;
    const touch = (navigator.maxTouchPoints || 0) > 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const long = Math.max(innerWidth, innerHeight) * dpr;
    return (touch && long >= 1280) || ((navigator.maxTouchPoints || 0) > 2 && Math.min(innerWidth, innerHeight) < 900);
  } catch (e) { return false; }
}
// yön değişince de doğru çalışsın: kısa kenar sabittir
function screenSize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let W = Math.round(innerWidth * dpr), H = Math.round(innerHeight * dpr);
  if (G.mobile) {
    const long = Math.max(innerWidth, innerHeight) * dpr;
    const maxLong = MOBILE_MAX_LONG * (G.resScale || 1);
    if (long > maxLong) { const k = maxLong / long; W = Math.round(W * k); H = Math.round(H * k); }
  }
  return [clamp(W & ~1, 320, 5120), clamp(H & ~1, 180, 2880)];
}

async function gpuInit() {
  if (!navigator.gpu) throw new Error('Bu tarayıcı WebGPU desteklemiyor. Android\'de Chrome 121+ ya da Edge deneyin.');
  const ad = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!ad) throw new Error('WebGPU adaptörü bulunamadı (grafik hızlandırma kapalı olabilir).');
  const feats = [];
  // 'timestamp-query' é pedido na medição de desempenho (?perf) e no jogo aberto por uma pessoa (benchmark e estatísticas
  // mostram o tempo de GPU quando o navegador permite); ?nots desliga. Captura, poses e testes continuam sem o recurso.
  for (const f of ['float32-filterable', 'rg11b10ufloat-renderable'].concat((Q.has('perf') || GAME.ui) && !Q.has('nots') ? ['timestamp-query'] : [])) if (ad.features.has(f)) feats.push(f);
  // float32-filterable ZORUNLU DEĞİL: mobil GPU'ların çoğunda yok ve bu yüzden
  // oyun açılmıyordu. Yerine shader'da elle bilineer okuma var (bkz. common.wgsl).
  G.hasF32Filter = ad.features.has('float32-filterable');
  G.hasTS = feats.includes('timestamp-query');
  // Sınırlar: adaptörün desteklediğinden fazlasını istemek cihazı düşürür
  // (bazı mobil GPU'larda dokulu bind grubu limiti 16'dır). Desteğin üstüne çıkmıyoruz.
  const lim = ad.limits;
  const req = { maxColorAttachmentBytesPerSample: Math.min(64, lim.maxColorAttachmentBytesPerSample), maxBufferSize: lim.maxBufferSize };
  if (lim.maxSampledTexturesPerShaderStage > 24) req.maxSampledTexturesPerShaderStage = 24;
  if (lim.maxTextureDimension2D > 8192) req.maxTextureDimension2D = 8192;
  let dev;
  try {
    dev = await ad.requestDevice({ requiredFeatures: feats, requiredLimits: req });
  } catch (e) {
    // Sınır isteği reddedildiyse varsayılan sınırlarla tekrar dene
    console.warn('[gpu] istenen sınırlar reddedildi, varsayılanlarla deneniyor:', e.message);
    dev = await ad.requestDevice({ requiredFeatures: feats });
  }
  G.dev = dev;
  G.limitTex = lim.maxTextureDimension2D;
  G.dev.addEventListener('uncapturederror', e => { console.error('GPU: ' + e.error.message); G.lastErr = e.error.message; });
  // Cihaz düşerse (bellek taşması, sürücü sıfırlaması, uygulama arkaya
  // alınması) eskiden hiçbir şey yapılmıyordu: siyah ekran öyle kalıyordu.
  // Artık önce daha düşük çözünürlükle kurtarılmaya çalışılır, o da olmazsa
  // ekrana anlaşılır bir mesaj yazılır.
  G.dev.lost.then(info => gpuLost(info));
  G.canvas = document.getElementById('c');
  G.scale = 1;
  const res = (Q.get('res') || '').split('x');
  if (res.length === 2) { G.W = clamp(+res[0] & ~1, 320, 5120); G.H = clamp(+res[1] & ~1, 180, 2880); }
  else { const s = screenSize(); G.W = s[0]; G.H = s[1]; }
  G.canvas.width = G.W; G.canvas.height = G.H;
  G.ctx = G.canvas.getContext('webgpu');
  G.fmt = navigator.gpu.getPreferredCanvasFormat();
  G.ctx.configure({ device: G.dev, format: G.fmt, alphaMode: 'opaque' });
  gpuMemCheck();
}

// ---- GPU bellek güvenlik ağı ----------------------------------------------
// Ekran boyutlu hedeflerin toplam dokusunun kaba tahmini (bayt/piksel).
// Bütçe aşılırsa çizim çözünürlüğü adım adım düşürülür. Bu kontrol mobil
// algısından BAĞIMSIZ çalışır: algı yanılsa bile oyun asla ~1 GB'lık hedefler
// kurmaz (ki bunu mobil GPU kaldıramıyor ve siyah ekran kalıyordu).
const MEM_BUDGET_MOBILE_MB = 300, MEM_BUDGET_HARD_MB = 500, MEM_MAX_LONG = 2600;
function gpuMemEstimate(W, H) {
  // Ekran boyutlu hedefler (21_post.js + 20_renderer.js), piksel başına ~69 B:
  // gA 4 + gB 8 + gC 4 + gV 4 + depth 4 + hdr 8 + hist×2 16 + vel 4 + mb 8 + yarım 6.
  const perPx = 69;
  // Sabit dokular (mobilde ölçüldü ~222 MB): gölge 1024²×3 + statik 2048², gökyüzü
  // 2048×512, ortam 256²×6, arazi/zona, pano atlası 4096×2048, çim atlası 512²×48.
  const fixed = G.mobile ? 222 : 400;
  return W * H * perPx / 1048576 + fixed;
}
function gpuMemCheck() {
  const budget = G.mobile ? MEM_BUDGET_MOBILE_MB : MEM_BUDGET_HARD_MB;
  const maxLong = G.mobile ? Math.round(MOBILE_MAX_LONG * (G.resScale || 1)) : MEM_MAX_LONG;
  // uzun kenar sınırı (yön ne olursa olsun)
  const long = Math.max(G.W, G.H);
  if (long > maxLong) { const k = maxLong / long; G.W = Math.max(320, (G.W * k) & ~1); G.H = Math.max(180, (G.H * k) & ~1); }
  G.memMB = Math.round(gpuMemEstimate(G.W, G.H));
  while (G.memMB > budget && G.W > 800) { G.W = (G.W * 0.85) & ~1; G.H = (G.H * 0.85) & ~1; G.memMB = Math.round(gpuMemEstimate(G.W, G.H)); }
  if (G.canvas) { G.canvas.width = G.W; G.canvas.height = G.H; }
  console.info('[gpu] çizim ' + G.W + '×' + G.H + ' · tahmini GPU belleği ~' + G.memMB + ' MB' + (G.mobile ? ' (mobil)' : ''));
}

// Cihaz kaybı: bir kez düşük çözünürlükle yeniden başlat, sonra mesaj göster.
function gpuLost(info) {
  const why = (info && info.reason) || 'unknown', msg = (info && info.message) || '';
  console.error('[gpu] cihaz düştü: ' + why + ' ' + msg);
  G.lastErr = 'GPU cihazı düştü (' + why + ')';
  if (GAME.lostHandled) return;
  GAME.lostHandled = true;
  try {
    // Bir sonraki açılışta daha düşük çözünürlükle başla: uyarlanabilir
    // ölçek kaydedilir, cihaz kaybının tekrarlanması engellenir.
    if (G.mobile) resScaleSet(Math.max(0.5, (G.resScale || 1) * 0.7));
    if (GAME.ready && !GAME.relaunched) { GAME.relaunched = true; location.replace(withParam('res', '960x432')); return; }
  } catch (e) { /* yok say */ }
  const el = document.getElementById('msg');
  if (el) { el.textContent = 'Grafik kartı oyunu durdurdu.\nSayfayı yenileyin; sürerse "res=960x432" adresiyle açın.'; el.style.whiteSpace = 'pre-wrap'; }
}
function withParam(k, v) {
  const q = new URLSearchParams(location.search); q.set(k, v); return location.pathname + '?' + q.toString() + location.hash;
}

const TU = { RT: 0x10, TB: 0x04, CS: 0x01, CD: 0x02, ST: 0x08 };
function mkTex(w, h, format, usage, extra) {
  const d = { size: [w, h, 1], format, usage: usage ?? (TU.RT | TU.TB), mipLevelCount: 1 };
  if (extra) Object.assign(d, extra);
  return G.dev.createTexture(d);
}
function mkBuf(size, usage, data) {
  const b = G.dev.createBuffer({ size: (size + 3) & ~3, usage, mappedAtCreation: !!data });
  if (data) { new Uint8Array(b.getMappedRange()).set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)); b.unmap(); }
  return b;
}
const BU = { V: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, I: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST, U: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, S: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST };

// Pré-processador: #include nome, #define NOME [valor], #ifdef/#ifndef/#else/#endif. Substitui macros por palavra inteira.
function wgslPP(name, defs) {
  defs = Object.assign({}, defs);
  const seen = {};
  const run = (nm) => {
    const src = WGSL[nm]; if (src === undefined) throw new Error('wgsl ausente: ' + nm);
    const out = []; const st = []; let on = true;
    for (const line of src.split('\n')) {
      const t = line.trim();
      if (t[0] === '#') {
        const p = t.split(/\s+/);
        if (p[0] === '#ifdef') { st.push(on); on = on && (p[1] in defs); continue; }
        if (p[0] === '#ifndef') { st.push(on); on = on && !(p[1] in defs); continue; }
        if (p[0] === '#else') { on = st[st.length - 1] && !on; continue; }
        if (p[0] === '#endif') { on = st.pop(); continue; }
        if (!on) continue;
        if (p[0] === '#include') { if (!seen[p[1]]) { seen[p[1]] = 1; out.push(run(p[1])); } continue; }
        if (p[0] === '#define') { defs[p[1]] = p.slice(2).join(' '); continue; }
        continue;
      }
      if (on) out.push(line);
    }
    return out.join('\n');
  };
  let code = 'diagnostic(off, derivative_uniformity);\n' + run(name);
  for (const k in defs) if (defs[k] !== '' && defs[k] !== true) code = code.replace(new RegExp('\\b' + k + '\\b', 'g'), defs[k]);
  return code;
}
const _modCache = {};
function mkShader(name, defs) {
  const key = name + JSON.stringify(defs || {});
  if (_modCache[key]) return _modCache[key];
  const code = wgslPP(name, defs);
  const m = G.dev.createShaderModule({ code, label: name });
  m.getCompilationInfo().then(info => {
    for (const msg of info.messages) if (msg.type === 'error') {
      const ln = code.split('\n'); console.error(`WGSL ${name}:${msg.lineNum}: ${msg.message}\n${ln.slice(Math.max(0, msg.lineNum - 3), msg.lineNum + 1).join('\n')}`);
      G.lastErr = `WGSL ${name}:${msg.lineNum}: ${msg.message}`;
    }
  });
  return _modCache[key] = m;
}
// Pipeline de tela cheia (triângulo único) com layout automático.
function mkFsPipe(name, defs, targets, opts) {
  const mod = mkShader(name, defs);
  return G.dev.createRenderPipeline({
    label: name, layout: 'auto',
    vertex: { module: mod, entryPoint: 'vs' },
    fragment: { module: mod, entryPoint: (opts && opts.entry) || 'fs', targets: targets.map(t => typeof t === 'string' ? { format: t } : t) },
    primitive: { topology: 'triangle-list' },
  });
}
function mkBG(pipe, idx, entries) {
  return G.dev.createBindGroup({ layout: pipe.getBindGroupLayout(idx), entries: entries.map((r, i) => ({ binding: i, resource: (r instanceof GPUBuffer) ? { buffer: r } : r })) });
}
function mkBGL(layout, entries) {
  return G.dev.createBindGroup({ layout, entries: entries.map((r, i) => ({ binding: i, resource: (r instanceof GPUBuffer) ? { buffer: r } : (r && r.buffer instanceof GPUBuffer) ? r : r })) });
}
// descritor de passe reutilizável (nenhuma alocação por quadro: só troca .view)
function mkPassDesc(nColor, depth, clear, label) {
  const d = { label, colorAttachments: [] };
  for (let i = 0; i < nColor; i++) d.colorAttachments.push({ view: null, loadOp: clear ? 'clear' : 'load', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } });
  if (depth) d.depthStencilAttachment = { view: null, depthLoadOp: depth === 'load' || depth === 'ro' ? 'load' : 'clear', depthStoreOp: 'store', depthClearValue: depth === 'clear1' ? 1 : 0 };
  if (depth === 'ro') { const a = d.depthStencilAttachment; delete a.depthLoadOp; delete a.depthStoreOp; delete a.depthClearValue; a.depthReadOnly = true; }
  return d;
}
// gera mips por blit linear (uso na inicialização)
let _mipPipe = {};
function genMips(tex, format, layers) {
  const dev = G.dev;
  if (!_mipPipe[format]) _mipPipe[format] = mkFsPipe('blit', {}, [format]);
  const pipe = _mipPipe[format];
  const samp = dev.createSampler({ minFilter: 'linear', magFilter: 'linear' });
  const enc = dev.createCommandEncoder();
  for (let L = 0; L < (layers || 1); L++) for (let m = 1; m < tex.mipLevelCount; m++) {
    const srcV = tex.createView({ dimension: '2d', baseMipLevel: m - 1, mipLevelCount: 1, baseArrayLayer: L, arrayLayerCount: 1 });
    const dstV = tex.createView({ dimension: '2d', baseMipLevel: m, mipLevelCount: 1, baseArrayLayer: L, arrayLayerCount: 1 });
    const p = enc.beginRenderPass({ colorAttachments: [{ view: dstV, loadOp: 'clear', storeOp: 'store' }] });
    p.setPipeline(pipe); p.setBindGroup(0, mkBG(pipe, 0, [srcV, samp])); p.draw(3); p.end();
  }
  dev.queue.submit([enc.finish()]);
}
const mipCount = (w, h) => 1 + Math.floor(Math.log2(Math.max(w, h)));
