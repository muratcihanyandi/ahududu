"""Oyun ↔ Ahududu kabuğu köprüsünü GERÇEK tarayıcıda ve GERÇEK sunucuda dener.

Neden ayrı bir araç: oyunun çok oyunculu katmanı ayrı bir iframe penceresinde
çalışır ve kabuğun soketini yalnızca köprü üzerinden kullanabilir. Bu yol bir
kez tamamen kopuktu (oyun kabuktan gelen paketleri hiç işlemiyordu). Bu test
kurgusu:

    • üst sayfa = Ahududu kabuğu (murat): soket + postMessage köprüsü
    • iframe    = oyunun 55_multiplayer.js soket bölümü (kabuk soketini kullanır)
    • ikinci pencere = selin'in oyunu (kendi soketini açar)

ve şunları doğrular:
    1. oyun köprüyü bulur ve kendi soketini AÇMAZ (tek bağlantı),
    2. oyunun gönderdiği paket kabuğun soketinden çıkar ve selin'e ulaşır,
    3. selin'in gönderdiği oyun paketi kabuktan iframe'e kadar gelir
       (partner arabası / 3-2-1 geri sayım bunun üzerinde çalışıyor).

Kullanım (yerel):
    python tests/dev_server.py            # 1. terminal
    python tests/test_game_bridge.py      # 2. terminal

Canlı sunucuya karşı (yalnızca sokak rölesi):
    python tests/live_ws_game_relay.py
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GAME_JS = ROOT / "frontend" / "public" / "games" / "uno-com-escada" / "source" / "js"
BASE = "http://127.0.0.1:33471"

WS_CLIENT_JS = """
function AhududuWS(user) { this.user = user; this.ws = null; this.handlers = {}; this.state = []; }
AhududuWS.prototype.connect = function () {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  this.ws = new WebSocket(proto + '//' + location.host + '/ws/' + this.user);
  this.ws.onmessage = e => {
    const d = JSON.parse(e.data);
    (this.handlers[d.type] || []).forEach(f => f(d));
    (this.handlers['*'] || []).forEach(f => f(d));
  };
};
AhududuWS.prototype.send = function (o) {
  if (!this.ws || this.ws.readyState !== 1) return false;
  this.ws.send(JSON.stringify(o)); return true;
};
AhududuWS.prototype.isOpen = function () { return !!(this.ws && this.ws.readyState === 1); };
AhududuWS.prototype.on = function (t, f) { (this.handlers[t] = this.handlers[t] || []).push(f); };
"""


def bridge_section() -> str:
    """55_multiplayer.js'in 1) SOKET bölümü (MPSHARE + NET)."""
    src = (GAME_JS / "55_multiplayer.js").read_text(encoding="utf-8")
    start = src.index("const BRIDGE_TAG")
    end = src.index("// ---------------------------- 2) OYUNCU")
    return src[start:end]


def game_srcdoc(user: str) -> str:
    return (
        "<!doctype html><meta charset=\"utf-8\"><script>\n"
        + bridge_section()
        + """
const GAME_ID = 'uno-com-escada';
const MP = { userId: '%s', retryAt: 0, partnerOn: false, hasT: false, lastRxCarAt: 0 };
function mpUiRefresh() {}
window.__packets = [];
window.__wsCreated = 0;
function __mpTestOnPacket(d) { window.__packets.push(d); }
MPSHARE.on(__mpTestOnPacket);
NET.connect();
window.__net = NET;
window.__share = MPSHARE;
window.__gameInfo = { live: NET.live, ready: MPSHARE.ready, hasNet: typeof NET !== 'undefined', hasShare: typeof MPSHARE !== 'undefined' };
</script>""" % user
    )


SHELL_HTML = """<!doctype html><meta charset="utf-8"><title>kopru testi</title>
<script src="/__ws_client.js"></script>
<iframe id="g" style="width:640px;height:360px"></iframe>
<script>
// ---- Ahududu kabuğu: services/gameBridge.ts + websocket.ts özeti ----
const wsClient = new AhududuWS('%s');
wsClient.connect();
const frame = document.getElementById('g');
const post = msg => frame.contentWindow.postMessage(Object.assign({ __ahududu: 1 }, msg), '*');
window.addEventListener('message', ev => {
  if (ev.source !== frame.contentWindow) return;
  const d = ev.data;
  if (!d || d.__ahududu !== 1) return;
  if (d.kind === 'hello' || d.kind === 'ping') post({ kind: 'ready' });
  else if (d.kind === 'send') wsClient.send(d.payload);
  else if (d.kind === 'state?') post({ kind: 'state', id: d.id, open: wsClient.isOpen() });
  else if (d.kind === 'fullscreen') window.__fullscreenRequested = true;
});
wsClient.on('*', data => {
  if (typeof data.type === 'string' && data.type.startsWith('game_')) post({ kind: 'recv', payload: data });
});
window.__ws = wsClient;
frame.srcdoc = %s;
</script>"""


def main() -> int:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("Playwright gerekli: pip install playwright")
        return 2

    bridge = bridge_section()
    # dikkat: json.dumps "</script>" ifadesini kaçırmaz; gömülü belge kapanış
    # etiketi üst sayfanın betiğini erken kapatmasın diye elle kaçırıyoruz.
    shell_doc = SHELL_HTML % ("murat", json.dumps(game_srcdoc("murat")).replace("</", "<\\/"))
    selin_doc = game_srcdoc("selin")
    local_ws_clients = 0

    ok = True

    def check(name, value):
        nonlocal ok
        print(("PASS  " if value else "FAIL  ") + name)
        ok = ok and bool(value)

    with sync_playwright() as p:
        # loopback yerel ağ sayıldığı için Chrome iframe içindeki WebSocket'i
        # engelleyebiliyor; testte bu koruma kapatılır (uygulama davranışı aynı).
        launch_args = [
            "--disable-features=BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights",
            "--enable-features=AllowLocalNetworkAccess",
        ]
        try:
            browser = p.chromium.launch(channel="chrome", headless=True, args=launch_args)
        except Exception:  # noqa: BLE001
            browser = p.chromium.launch(headless=True, args=launch_args)
        ctx = browser.new_context()

        shell = ctx.new_page()
        console = []
        shell.on("console", lambda m: console.append(m.text))
        shell.route("**/__shell.html", lambda route: route.fulfill(content_type="text/html", body=shell_doc))
        shell.route("**/__ws_client.js", lambda route: route.fulfill(
            content_type="application/javascript", body=WS_CLIENT_JS))
        shell.goto(f"{BASE}/__shell.html")
        shell.wait_for_timeout(2500)
        shell_ws_open = shell.evaluate("() => window.__ws && window.__ws.isOpen()")

        # 1) oyun köprüyü buldu, kendi soketini açmadı
        live = shell.frames[1].evaluate("() => (window.__net ? NET.live : null)")
        share_ready = shell.frames[1].evaluate("() => (window.__share ? MPSHARE.ready : null)")
        check("kabuk soketi açık (test ön koşulu)", shell_ws_open)
        check("oyun kabuk soketi üzerinden bağlı görünüyor (NET.live)", live)
        check("oyun köprüyü tanıdı (MPSHARE.ready)", share_ready)

        selin = ctx.new_page()
        selin.on("console", lambda m: console.append("selin: " + m.text))
        selin.route("**/__selin.html", lambda route: route.fulfill(content_type="text/html", body=selin_doc))
        selin.goto(f"{BASE}/__selin.html")
        selin.wait_for_timeout(2500)
        selin_live = selin.evaluate("() => window.__net.live")
        check("selin'in oyunu kendi soketine bağlandı", selin_live)

        # 2) oyun -> kabuk -> sunucu -> selin
        shell.frames[1].evaluate(
            "() => NET.json({ type: 'game_car', d: [1, 2, 3, 0.5, 9.5, 2, 1, 10, 0] })")
        shell.wait_for_timeout(1000)
        selin_packets = selin.evaluate("() => window.__packets.map(p => p.type)")
        check("oyun paketi kabuk soketinden selin'e ulaştı (game_car)",
              "game_car" in selin_packets)

        # 3) selin -> sunucu -> kabuk -> oyun iframe'i
        selin.evaluate(
            "() => NET.json({ type: 'game_car', d: [7, 8, 9, 0.1, 3.3, 1, -1, 11, 0.4] })")
        shell.wait_for_timeout(1000)
        game_packets = shell.frames[1].evaluate("() => window.__packets.map(p => p.type)")
        check("partner paketi kabuktan oyun iframe'ine iletildi",
              "game_car" in game_packets)

        if not ok:
            print("konsol:", "\n".join(console[-12:]))

        # 4) tam ekran isteği kabuğa ulaşır (oyun iframe'i kendi tam ekranını açamaz)
        shell.frames[1].evaluate("() => MPSHARE.fullscreen()")
        shell.wait_for_timeout(400)
        check("oyunun tam ekran isteği kabuğa ulaştı",
              shell.evaluate("() => !!window.__fullscreenRequested"))

        browser.close()

    if not ok:
        print("\nKÖPRÜ TESTİ BAŞARISIZ")
        return 1
    print("\nKÖPRÜ TESTİ TAMAM")
    return 0


if __name__ == "__main__":
    sys.exit(main())
