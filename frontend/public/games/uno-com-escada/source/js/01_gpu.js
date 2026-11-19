// Dispositivo WebGPU, utilitários de recurso e pré-processador de WGSL.
const Q = new URLSearchParams(location.search);
const BUILD = [];           // construtores de cena registrados pelos outros arquivos: async fn(), executados em ordem por main()
const GAME = { ready: false, mode: Q.get('scene') || 'game', capture: Q.has('cap'), tick: null, init: null, minFrameMs: 0, gpuWorstMs: 0, ui: false };
// Jogo aberto por uma pessoa (tela de início, painel, som) × ferramenta (captura, poses, teste, medição): as ferramentas de
// trabalho/ usam ?cap, ?perf, ?replay ou rodam num navegador automatizado, e para elas nada muda — sem menu, sem painel.
// ?ui=1 força o jogo completo (é como os testes de menu, entrada e som o abrem); ?ui=0 força o modo de ferramenta.
GAME.ui = Q.has('ui') ? Q.get('ui') !== '0' : !(Q.has('cap') || Q.has('perf') || Q.has('replay') || Q.has('auto') || Q.has('scene'));
// Tempo em vetor tipado (escrita por quadro sem caixa na heap): RT[0] = tempo acumulado (s), RT[1] = dt do quadro renderizado, RT[2] = dt pedido ao jogo
const RT = new Float64Array([0, 1 / 60, 1 / 60, 0]);   // RT[3] = intervalo real do último quadro (ms), para as estatísticas
const G = {
  dev: null, ctx: null, fmt: 'bgra8unorm', W: 0, H: 0, hasTS: false, canvas: null, resScale: 1,
  mobile: !Q.has('detay') && !Q.has('res') && ((navigator.maxTouchPoints || 0) > 0 || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || ''))
};
const MOBILE_MAX_LONG = 960;
function calcRenderSize() {
  const res = (Q.get('res') || '').split('x');
  if (res.length === 2) return [clamp(+res[0] & ~1, 320, 5120), clamp(+res[1] & ~1, 180, 2880)];
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let rawW = Math.round(innerWidth * dpr), rawH = Math.round(innerHeight * dpr);
  if (rawH > rawW) { const t = rawW; rawW = rawH; rawH = t; }
  if (G.mobile) {
    const maxL = Math.round(MOBILE_MAX_LONG * (G.resScale || 1));
    if (rawW > maxL) {
      const k = maxL / rawW;
      rawW = Math.round(rawW * k);
      rawH = Math.round(rawH * k);
    }
  }
  return [clamp(rawW & ~1, 320, 5120), clamp(rawH & ~1, 180, 2880)];
}

async function gpuInit() {
  if (!navigator.gpu) throw new Error('Bu tarayıcıda WebGPU desteklenmiyor.');
  const ad = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!ad) throw new Error('WebGPU adaptörü bulunamadı.');
  const feats = [];
  // 'timestamp-query' é pedido na medição de desempenho (?perf) e no jogo aberto por uma pessoa (benchmark e estatísticas
  // mostram o tempo de GPU quando o navegador permite); ?nots desliga. Captura, poses e testes continuam sem o recurso.
  for (const f of ['float32-filterable', 'rg11b10ufloat-renderable'].concat((Q.has('perf') || GAME.ui) && !Q.has('nots') ? ['timestamp-query'] : [])) if (ad.features.has(f)) feats.push(f);
  G.hasF32Filter = ad.features.has('float32-filterable');
  G.hasTS = feats.includes('timestamp-query');
  const lim = ad.limits;
  const reqLim = { maxColorAttachmentBytesPerSample: Math.min(64, lim.maxColorAttachmentBytesPerSample), maxBufferSize: lim.maxBufferSize };
  if (lim.maxSampledTexturesPerShaderStage >= 24) reqLim.maxSampledTexturesPerShaderStage = 24;
  if (lim.maxTextureDimension2D >= 8192) reqLim.maxTextureDimension2D = 8192;
  G.dev = await ad.requestDevice({ requiredFeatures: feats, requiredLimits: reqLim });
  G.dev.addEventListener('uncapturederror', e => { console.error('GPU: ' + e.error.message); G.lastErr = e.error.message; });
  G.canvas = document.getElementById('c');
  const sz = calcRenderSize();
  G.W = sz[0]; G.H = sz[1];
  G.canvas.width = G.W; G.canvas.height = G.H;
  G.ctx = G.canvas.getContext('webgpu');
  G.fmt = navigator.gpu.getPreferredCanvasFormat();
  G.ctx.configure({ device: G.dev, format: G.fmt, alphaMode: 'opaque' });
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
