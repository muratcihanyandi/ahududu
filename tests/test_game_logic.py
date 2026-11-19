"""Oyunun çok oyunculu/spawn mantığını GERÇEK sahne + sahte WebGPU ile dener.

Sahne gerçekten kurulur (araba, pist, menü); yalnızca GPU cihazı sahtedir, bu
yüzden mantık testleri sahne kodunu değiştirmeden çalışır. Doğrulananlar:

  • kendi arabamızın mesh listesi partner arabası kurulunca BOŞALMIYOR
    (eski hata: araba hiç çizilmiyordu),
  • partner oyunda yokken pistte araba yok; "hello" gelince arabası belirir,
  • "game_bye" ile pistten kalkar, konum paketiyle gerçek yere oturur,
  • menüdeki durum yazısı teknik detaysız.

Kullanım: python tests/test_game_logic.py
"""

import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
GAME = ROOT / "frontend" / "public" / "games" / "uno-com-escada" / "index.html"

HARNESS = r"""
// Sahte WebGPU cihazı: SAHNE kodunu değiştirmeden mantık testleri için.
// Sahne cihazı G.dev üzerinden kullanır; apiEncoder/apiPass (20_renderer.js) tek
// kapıdır. navigator.gpu'daki adapter da bu cihazı döndürür.
const noop = () => { };
const _pass = { draw: noop, drawIndexed: noop, setPipeline: noop, setBindGroup: noop, setVertexBuffer: noop, setIndexBuffer: noop, end: noop, setViewport: noop, setScissorRect: noop, pushDebugGroup: noop, popDebugGroup: noop, insertDebugMarker: noop };
const _encoder = { beginRenderPass: () => _pass, beginComputePass: () => _pass, finish: () => ({}), insertDebugMarker: noop, pushDebugGroup: noop, popDebugGroup: noop, copyTextureToTexture: noop, copyBufferToBuffer: noop, resolveQuerySet: noop, copyTextureToBuffer: noop, copyBufferToTexture: noop };
const _pipe = { getBindGroupLayout: () => ({}) };
const _queue = Object.assign(Object.create(window.GPUQueue ? GPUQueue.prototype : Object.prototype), {
  submit: noop, writeBuffer: noop, writeTexture: noop, onSubmittedWorkDone: () => Promise.resolve(),
  copyExternalImageToTexture: noop,
});
const _dev = {
  createShaderModule: () => ({ getCompilationInfo: async () => ({ messages: [] }) }), createRenderPipeline: () => _pipe, createRenderPipelineAsync: () => Promise.resolve(_pipe),
  createComputePipeline: () => _pipe, createComputePipelineAsync: () => Promise.resolve(_pipe),
  createPipelineLayout: () => ({}), createBindGroupLayout: () => ({}), createBindGroup: () => ({}),
  createSampler: () => ({}),
  createBuffer(o) { const n = (o && o.size) || 4; return { size: n, destroy: noop, getMappedRange: () => new ArrayBuffer(n), unmap: noop, mapAsync: () => Promise.resolve(), usage: (o && o.usage) || 0 }; },
  createTexture(o) { return { width: 4, height: 4, format: (o && o.format) || 'rgba8unorm', createView: () => ({}), destroy: noop, mipLevelCount: 6, sampleCount: 1, usage: (o && o.usage) || 0 }; },
  createCommandEncoder: () => _encoder,
  createQuerySet: () => ({ destroy: noop }),
  addEventListener: noop, removeEventListener: noop, pushErrorScope: noop, popErrorScope: () => Promise.resolve(null),
  features: new Set(['depth-clip-control']),
  limits: { maxSampledTexturesPerShaderStage: 24, maxTextureDimension2D: 8192, maxColorAttachmentBytesPerSample: 64, maxBufferSize: 268435456, maxTextureDimension3D: 2048, maxStorageBufferBindingSize: 134217728, maxVertexBuffers: 8, maxBindGroups: 4, maxUniformBufferBindingSize: 65536 },
  queue: _queue,
  lost: new Promise(() => { }),
};
const _gpuCanvasCtx = Object.assign(Object.create(window.GPUCanvasContext ? GPUCanvasContext.prototype : Object.prototype), {
  getCurrentTexture: () => ({ createView: () => ({}) }), configure: noop, unconfigure: noop,
});
const _origGetContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (kind, opts) {
  if (kind === 'webgpu') return _gpuCanvasCtx;
  return _origGetContext.call(this, kind, opts);   // 2B: GERÇEK bağlam (HUD/atlas çizimi)
};
const _origRequestAdapter = navigator.gpu && navigator.gpu.requestAdapter ? navigator.gpu.requestAdapter.bind(navigator.gpu) : null;
try {
  Object.defineProperty(navigator, 'gpu', {
    configurable: true,
    value: {
      requestAdapter: async () => ({ features: new Set(), limits: _dev.limits, requestDevice: async () => _dev }),
      getPreferredCanvasFormat: () => 'bgra8unorm',
    },
  });
} catch (e) { /* tarayıcı izin vermezse gpuInit gerçek cihazla dener */ }
window.__fakeDev = _dev;
"""

CHECKS = r"""() => {
  const out = [];
  const push = (n, v, x) => out.push({ n, v: !!v, x: x === undefined ? '' : String(x) });
  const cap = window.__cap, mpApi = window.__mp;
  const R = cap.R, MP = mpApi.mp;
  push('sahne hazır (menü açık)', cap.ready());
  push('partner arabası kuruldu', MP.carReady);
  // Partnerin çizim listesindeki MeshSet'i kendi arabamızla AYNI meshleri kullanmalı;
  // kendi arabamızın mesh sayılarını oyunun teşhis köprüsünden (window.__mp.carInfo) al.
  const info = mpApi.carInfo ? mpApi.carInfo() : null;
  push('kendi araba mesh listesi DOLU (araba çizilebilir)', !!info && info.ownItems >= 5, info ? info.ownItems : 'n/a');
  push('kendi camları yerinde', !!info && info.ownGlass >= 1, info ? info.ownGlass : 'n/a');
  const isPartnerShown = () => R.drawables.indexOf(MP.drawable || MP.set) >= 0;
  push('partner arabası başta pistte DEĞİL', !isPartnerShown());

  mpApi.packet({ type: 'game_hello', from: 'selin', seq: 1 });
  push('hello -> partner pistte görünür', isPartnerShown());
  mpApi.packet({ type: 'game_car', d: [55, 1.5, 66, 0.4, 12, 3, 1, 70, -1] });
  push('konum paketi alındı', MP.hasT && Math.abs(MP.S.x - 55) < 1e-6 && Math.abs(MP.S.z - 66) < 1e-6, MP.S.x + ',' + MP.S.z);

  // Çarpışma testi: iki araba üst üste/yakın gelince itki + hits artışı olmalı
  const V = cap.VEH;
  const oldX = V.x, oldZ = V.z, oldHits = V.hits;
  V.vx = 18; V.vy = 0; V.r = 0;
  const c = Math.cos(V.yaw), s = Math.sin(V.yaw);
  mpApi.packet({ type: 'game_car', d: [V.x + c * 1.1, V.y, V.z + s * 1.1, V.yaw, 0, 1, 1, V.s + 1.1, V.d, 0, 0, 0, 0, 0, 0] });
  // İlk pakette uzaklıktan sıçrayarak konuma oturur; hemen çarpışma testini çalıştır
  MP.lastCrashAt = 0;
  mpApi.collide();
  const moved = Math.hypot(V.x - oldX, V.z - oldZ);
  push('araba çarpışması -> pozisyon ayrıştı ve hız düştü', moved > 0.05 && V.vx < 18 && V.hits > oldHits, 'moved=' + moved.toFixed(2) + ' vx=' + V.vx.toFixed(2) + ' hits=' + V.hits);

  // Gelen game_hit paketi -> karşıdan gelen darbe uygulanır
  MP.lastCrashAt = 0;
  const preVx = V.vx;
  mpApi.packet({ type: 'game_hit', from: 'selin', ix: -c * 5, iz: -s * 5, tr: 0.4 });
  push('game_hit -> karşıdan çarpışma darbesi uygulandı', V.vx < preVx - 1, 'pre=' + preVx.toFixed(2) + ' post=' + V.vx.toFixed(2));

  mpApi.packet({ type: 'game_bye', from: 'selin' });
  push('bye -> partner pistten kalktı', !isPartnerShown(), 'shown=' + isPartnerShown() + ' partnerOn=' + MP.partnerOn);
  const txt = document.getElementById('mpStat').textContent;
  push('durum yazısı teknik detaysız', !/WebGPU|ms|FPS|çözünürlük/i.test(txt), txt);
  const uiTxt = document.getElementById('ui').innerText;
  const hintDisp = getComputedStyle(document.getElementById('hint')).display;
  push('WASD yönergesi kapalı ve menü Türkçe', hintDisp === 'none' && !/Teclado|W ou|Começar/i.test(uiTxt) && /Başla/.test(uiTxt), 'hint=' + hintDisp);
  const info2 = mpApi.carInfo ? mpApi.carInfo() : null;
  push('kendi arabamızın meshleri hâlâ yerinde', !!info2 && info2.ownItems >= 5, info2 ? info2.ownItems : 'n/a');
  return out;
}"""


def main() -> int:
    with sync_playwright() as p:
        try:
            browser = p.chromium.launch(channel="chrome", headless=True)
        except Exception:  # noqa: BLE001
            browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.add_init_script(HARNESS)
        page.goto(GAME.as_uri())
        page.wait_for_function("() => window.__cap && (window.__cap.ready() || window.__cap.error())", timeout=180000)
        err = page.evaluate("() => ({ ready: window.__cap.ready(), err: window.__cap.error() })")
        if not err["ready"]:
            print("FAIL  sahne kurulamadı:", err["err"])
            print("JS HATALARI:", errors[:5])
            browser.close()
            return 1
        checks = page.evaluate(CHECKS)
        browser.close()

    ok = True
    for c in checks:
        print(("PASS  " if c["v"] else "FAIL  ") + c["n"] + ((" :: " + c["x"]) if c["x"] else ""))
        ok = ok and c["v"]
    if errors:
        print("JS HATALARI:")
        for e in errors[:6]:
            print("  ", e)
        ok = False
    print("\nOYUN MANTIK TESTİ " + ("TAMAM" if ok else "BAŞARISIZ"))
    return 0 if ok else 1


def test_real_gpu_two_players() -> bool:
    """Gerçek WebGPU ile (sahte cihaz olmadan) 2. oyuncu girince ekranın kararmadığını ve hata vermediğini doğrular."""
    with sync_playwright() as p:
        try:
            browser = p.chromium.launch(channel="chrome", headless=True)
        except Exception:  # noqa: BLE001
            browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1280, "height": 720})
        errors = []
        gpu_errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: gpu_errors.append(m.text) if m.type == "error" else None)
        page.goto(GAME.as_uri())
        page.wait_for_function("() => window.__cap && (window.__cap.ready() || window.__cap.error())", timeout=180000)
        init = page.evaluate("""() => ({
            ready: window.__cap.ready(),
            err: window.__cap.error(),
            b0Visible: document.getElementById('b0').offsetHeight > 0,
            b1Visible: document.getElementById('b1').offsetHeight > 0,
        })""")
        if not init["ready"]:
            print("SKIP  gerçek WebGPU bu ortamda kullanılamıyor:", init["err"])
            browser.close()
            return True
        page.click("#b0")
        page.wait_for_timeout(300)
        # 2. oyuncu (Selin) oyuna girsin ve aracımızın hemen önüne (6m ileri) spawn olsun
        page.evaluate("""() => {
            const V = window.__cap.VEH;
            const c = Math.cos(V.yaw), s = Math.sin(V.yaw);
            window.__mp.packet({ type: 'game_hello', from: 'selin', seq: 1 });
            window.__mp.packet({ type: 'game_car', from: 'selin', d: [V.x + c * 6, V.y, V.z + s * 6, V.yaw, 0, 1, 1, V.s + 6, V.d, 0] });
        }""")
        page.wait_for_timeout(800)
        res = page.evaluate("""() => {
            window.__cap.renderFrame();
            const c = document.createElement('canvas'); c.width = 64; c.height = 64;
            const ctx = c.getContext('2d');
            ctx.drawImage(document.getElementById('c'), 0, 0, 64, 64);
            const data = ctx.getImageData(0, 0, 64, 64).data;
            let nonBlack = 0;
            for (let i = 0; i < data.length; i += 4) {
                if (data[i] > 5 || data[i + 1] > 5 || data[i + 2] > 5) nonBlack++;
            }
            return {
                err: window.__cap.error(),
                lastErr: window.__cap.G.lastErr || null,
                nonBlackPixels: nonBlack,
                totalPixels: 64 * 64,
                shown: window.__mp.state().shown,
            };
        }""")
        page.screenshot(path=str(ROOT / "tests" / "_real_gpu_2players.png"))
        browser.close()

    ok = True
    for name, val, extra in [
        ("gerçek GPU: başlangıçta her iki buton (b0, b1) görünür", init["b0Visible"] and init["b1Visible"], str(init)),
        ("gerçek GPU: 2. oyuncu girince WebGPU/shader hatası yok", not res["err"] and not res["lastErr"] and not gpu_errors, f"err={res['err']} gpu={gpu_errors}"),
        ("gerçek GPU: 2. oyuncu girince ekran simsiyah kalmıyor", res["nonBlackPixels"] > 3000, f"nonBlack={res['nonBlackPixels']}/{res['totalPixels']}"),
        ("gerçek GPU: 2. oyuncunun aracı sahnede çiziliyor", res["shown"], ""),
    ]:
        print(("PASS  " if val else "FAIL  ") + name + ((" :: " + extra) if extra else ""))
        ok = ok and bool(val)
    return ok


if __name__ == "__main__":
    rc = main()
    if rc == 0 and not test_real_gpu_two_players():
        rc = 1
    sys.exit(rc)
