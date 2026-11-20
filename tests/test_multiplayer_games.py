"""Backend unit/WS integration and live two-player Playwright E2E tests for all Ahududu multiplayer games."""

from __future__ import annotations

import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

TMP_UNIT = tempfile.mkdtemp(prefix="ahududu_games_unit_")
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///" + os.path.join(TMP_UNIT, "games_unit.db"))
os.environ.setdefault("UPLOAD_DIR", os.path.join(TMP_UNIT, "uploads"))
os.environ.setdefault("STATIC_DIR", str(ROOT / "backend" / "static"))

from backend.app.main import app  # noqa: E402
from backend.app.services.push_notifications import build_push_payload  # noqa: E402
from backend.app.websocket_manager import ws_manager  # noqa: E402


# ---------------------------------------------------------------------------
# Bolum A: Backend Unit & WebSocket Integration
# ---------------------------------------------------------------------------

def test_games_presence_and_disconnect_cleanup():
    ws_manager.active_games.clear()
    with TestClient(app) as client:
        r0 = client.get("/api/games/presence")
        assert r0.status_code == 200
        assert r0.json() == {"murat": None, "selin": None}

        with client.websocket_connect("/ws/murat") as ws_m:
            init_m = ws_m.receive_json()
            assert init_m["type"] == "partner_status"

            ws_m.send_json({
                "type": "game_presence",
                "game": "chess-duel",
                "title": "Satranç Düellosu",
                "emoji": "♟️",
            })

            # Presence API aninda dolmali
            r1 = client.get("/api/games/presence")
            assert r1.status_code == 200
            assert r1.json()["murat"]["game"] == "chess-duel"
            assert r1.json()["selin"] is None

            # Selin baglaninca Murat'in aktif oyununu otomatik almali
            with client.websocket_connect("/ws/selin") as ws_s:
                seen_s = []
                for _ in range(4):
                    seen_s.append(ws_s.receive_json())
                    if any(m.get("type") == "game_presence" and m.get("game") == "chess-duel" for m in seen_s):
                        break
                assert any(
                    m.get("type") == "game_presence"
                    and m.get("user_id") == "murat"
                    and m.get("game") == "chess-duel"
                    for m in seen_s
                )

                # Farkli oyun paketleri `game` alanini bozmadan aktarilmali
                ws_m.send_json({
                    "type": "game_2048_attack",
                    "game": "battle-2048",
                    "count": 2,
                    "fromTile": 256,
                })
                pkt = None
                for _ in range(5):
                    cand = ws_s.receive_json()
                    if cand.get("type") == "game_2048_attack":
                        pkt = cand
                        break
                assert pkt is not None
                assert pkt["from"] == "murat"
                assert pkt["game"] == "battle-2048"
                assert pkt["count"] == 2

                # Murat baglantisini kapatinca active_games temizlenmeli ve Selin game_bye + game_presence(None) almali
                ws_m.close()
                after_close = []
                for _ in range(5):
                    after_close.append(ws_s.receive_json())
                    has_pres_none = any(m.get("type") == "game_presence" and m.get("game") is None for m in after_close)
                    has_bye = any(m.get("type") == "game_bye" and m.get("game") == "chess-duel" for m in after_close)
                    if has_pres_none and has_bye:
                        break
                assert any(m.get("type") == "game_presence" and m.get("game") is None for m in after_close)
                assert any(m.get("type") == "game_bye" and m.get("game") == "chess-duel" for m in after_close)

        r2 = client.get("/api/games/presence")
        assert r2.json() == {"murat": None, "selin": None}


def test_game_invite_push_payload():
    ev = {
        "type": "game_invite",
        "from": "murat",
        "game": "chess-duel",
        "title": "Satranç Düellosu",
        "emoji": "♟️",
    }
    p_selin = build_push_payload("selin", ev)
    assert p_selin is not None
    assert p_selin["target"] == "games"
    assert "Murat" in p_selin["title"]
    assert "Satranç Düellosu" in p_selin["body"]
    assert build_push_payload("murat", ev) is None


# ---------------------------------------------------------------------------
# Bolum B: Canli Iki Oyunculu Playwright E2E (Gercek Uvicorn Sunucusu)
# ---------------------------------------------------------------------------

def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


@pytest.fixture(scope="module")
def live_server():
    port = _free_port()
    tmp_dir = tempfile.mkdtemp(prefix="ahududu_games_e2e_")
    env = os.environ.copy()
    env["DATABASE_URL"] = "sqlite+aiosqlite:///" + os.path.join(tmp_dir, "e2e.db")
    env["UPLOAD_DIR"] = os.path.join(tmp_dir, "uploads")
    env["STATIC_DIR"] = str(ROOT / "backend" / "static")
    env["ENV"] = "test"

    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "backend.app.main:app", "--host", "127.0.0.1", "--port", str(port), "--log-level", "warning"],
        cwd=str(ROOT),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    base_url = f"http://127.0.0.1:{port}"
    deadline = time.time() + 20
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(base_url + "/api/system/version", timeout=1) as resp:
                if resp.status == 200:
                    break
        except Exception:
            time.sleep(0.2)
    else:
        proc.terminate()
        out = proc.stdout.read().decode("utf-8", errors="replace") if proc.stdout else ""
        raise RuntimeError(f"Uvicorn failed to start on port {port}: {out}")

    try:
        yield base_url
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()


@pytest.fixture(scope="module")
def browser():
    with sync_playwright() as p:
        try:
            b = p.chromium.launch(channel="chrome", headless=True)
        except Exception:
            b = p.chromium.launch(headless=True)
        yield b
        b.close()


def _open_pair(browser, url_murat: str, url_selin: str, ready_expr: str):
    ctx_m = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True)
    ctx_s = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True)
    pm = ctx_m.new_page()
    ps = ctx_s.new_page()
    errors = []

    def attach_err(tag, pg):
        pg.on("pageerror", lambda e: errors.append(f"{tag} pageerror: {e}"))
        pg.on("console", lambda m: errors.append(f"{tag} console.{m.type}: {m.text}") if m.type == "error" else None)

    attach_err("murat", pm)
    attach_err("selin", ps)
    pm.goto(url_murat)
    ps.goto(url_selin)
    pm.wait_for_function(ready_expr, timeout=10000)
    ps.wait_for_function(ready_expr, timeout=10000)
    return ctx_m, ctx_s, pm, ps, errors


def _filter_errors(errors):
    return [e for e in errors if "favicon" not in e.lower() and "audiocontext" not in e.lower()]


def test_e2e_chess_duel(live_server, browser):
    ctx_m, ctx_s, pm, ps, errors = _open_pair(
        browser,
        f"{live_server}/games/chess-duel/index.html?u=murat",
        f"{live_server}/games/chess-duel/index.html?u=selin",
        "() => window.__chessTest && window.__chessTest.getState().partnerOnline === true",
    )
    try:
        assert pm.evaluate("() => window.__chessTest.playMove('e2', 'e4')") is True
        ps.wait_for_function("() => window.__chessTest.getState().history.length === 1", timeout=6000)
        st_s = ps.evaluate("() => window.__chessTest.getState()")
        assert st_s["history"] == ["e4"]
        assert st_s["turn"] == "b"

        assert ps.evaluate("() => window.__chessTest.playMove('e7', 'e5')") is True
        pm.wait_for_function("() => window.__chessTest.getState().history.length === 2", timeout=6000)
        st_m = pm.evaluate("() => window.__chessTest.getState()")
        assert st_m["history"] == ["e4", "e5"]
        assert st_m["turn"] == "w"
        assert not _filter_errors(errors), errors
    finally:
        ctx_m.close()
        ctx_s.close()


def test_e2e_battle_2048(live_server, browser):
    ctx_m, ctx_s, pm, ps, errors = _open_pair(
        browser,
        f"{live_server}/games/battle-2048/index.html?u=murat",
        f"{live_server}/games/battle-2048/index.html?u=selin",
        "() => window.__g2048Test && window.__g2048Test.getState().partnerOnline === true",
    )
    try:
        pm.evaluate("() => window.__g2048Test.startDuel('attack', 12345)")
        ps.wait_for_function("() => window.__g2048Test.getState().grid.filter(x => x > 0).length === 2", timeout=5000)
        for d in ("left", "down", "right", "up", "left"):
            pm.evaluate("(dir) => window.__g2048Test.move(dir)", d)
        pm.evaluate("() => window.__g2048Test.triggerAttack(1, 128)")

        ps.wait_for_function("() => window.__g2048Test.getState().grid.some(x => x < 0)", timeout=6000)
        ps.wait_for_function("() => window.__g2048Test.getState().rivalGrid.some(x => x > 0)", timeout=6000)
        assert not _filter_errors(errors), errors
    finally:
        ctx_m.close()
        ctx_s.close()


def test_e2e_blok_duello(live_server, browser):
    ctx_m, ctx_s, pm, ps, errors = _open_pair(
        browser,
        f"{live_server}/games/blok-duello/index.html?u=murat",
        f"{live_server}/games/blok-duello/index.html?u=selin",
        "() => window.__tetrisTest && window.__tetrisTest.getState().partnerOnline === true",
    )
    try:
        pm.evaluate("() => window.__tetrisTest.startDuel(54321)")
        pm.evaluate("() => window.__tetrisTest.hardDrop()")
        pm.evaluate("() => window.__tetrisTest.sendGarbage(2)")

        ps.wait_for_function("() => window.__tetrisTest.getState().pendingGarbage >= 2", timeout=6000)
        ps.wait_for_function("() => window.__tetrisTest.getState().rivalCells > 0", timeout=6000)
        assert not _filter_errors(errors), errors
    finally:
        ctx_m.close()
        ctx_s.close()


def test_e2e_neon_air_hockey(live_server, browser):
    ctx_m, ctx_s, pm, ps, errors = _open_pair(
        browser,
        f"{live_server}/games/neon-air-hockey/index.html?u=murat",
        f"{live_server}/games/neon-air-hockey/index.html?u=selin",
        "() => window.__hockeyTest && window.__hockeyTest.getState().partnerOnline === true",
    )
    try:
        ps.evaluate("() => window.__hockeyTest.setPaddle(0.32, 1.15)")
        pm.wait_for_function("() => Math.abs(window.__hockeyTest.getState().selin.x - 0.68) < 0.05", timeout=6000)
        ps.wait_for_function("() => window.__hockeyTest.getState().lastRxSeq > 0", timeout=6000)
        assert not _filter_errors(errors), errors
    finally:
        ctx_m.close()
        ctx_s.close()


def test_e2e_ciz_tahmin(live_server, browser):
    ctx_m, ctx_s, pm, ps, errors = _open_pair(
        browser,
        f"{live_server}/games/ciz-tahmin/index.html?u=murat",
        f"{live_server}/games/ciz-tahmin/index.html?u=selin",
        "() => window.__drawTest && window.__drawTest.getState().partnerOnline === true",
    )
    try:
        pm.evaluate("() => window.__drawTest.startMatch()")
        pm.evaluate("() => window.__drawTest.pickWord(0)")
        ps.wait_for_function("() => window.__drawTest.getState().phase === 'draw'", timeout=6000)

        pm.evaluate("() => window.__drawTest.drawStroke([{x:0.2,y:0.2},{x:0.75,y:0.7}])")
        ps.wait_for_function("() => window.__drawTest.getState().strokeCount >= 1", timeout=6000)

        secret = pm.evaluate("() => window.__drawTest.getState().currentWord")
        assert secret
        # ASCII eslestirme testi icin Turkce karakterleri de cevirip yollayalim
        ascii_guess = (
            secret.replace("İ", "i").replace("I", "i").replace("ı", "i")
            .replace("Ş", "s").replace("ş", "s")
            .replace("Ğ", "g").replace("ğ", "g")
            .replace("Ü", "u").replace("ü", "u")
            .replace("Ö", "o").replace("ö", "o")
            .replace("Ç", "c").replace("ç", "c")
        )
        ps.evaluate("(g) => window.__drawTest.submitGuess(g)", ascii_guess)
        pm.wait_for_function("() => window.__drawTest.getState().scores.selin > 0", timeout=6000)
        ps.wait_for_function("() => window.__drawTest.getState().scores.selin > 0", timeout=6000)
        st_m = pm.evaluate("() => window.__drawTest.getState()")
        assert st_m["scores"]["murat"] > 0 and st_m["scores"]["selin"] > 0
        assert not _filter_errors(errors), errors
    finally:
        ctx_m.close()
        ctx_s.close()


def test_e2e_amiral_batti(live_server, browser):
    ctx_m, ctx_s, pm, ps, errors = _open_pair(
        browser,
        f"{live_server}/games/amiral-batti/index.html?u=murat",
        f"{live_server}/games/amiral-batti/index.html?u=selin",
        "() => window.__shipTest && window.__shipTest.getState().partnerOnline === true",
    )
    try:
        pm.evaluate("() => { window.__shipTest.randomizeFleet(); window.__shipTest.markReady(); }")
        ps.evaluate("() => { window.__shipTest.randomizeFleet(); window.__shipTest.markReady(); }")
        pm.wait_for_function("() => window.__shipTest.getState().phase === 'battle'", timeout=6000)
        ps.wait_for_function("() => window.__shipTest.getState().phase === 'battle'", timeout=6000)

        assert pm.evaluate("() => window.__shipTest.fireAt(0, 0)") is True
        ps.wait_for_function("() => window.__shipTest.getState().enemyShotsCount === 1", timeout=6000)
        pm.wait_for_function("() => window.__shipTest.getState().myShotsCount === 1", timeout=6000)
        st_m = pm.evaluate("() => window.__shipTest.getState()")
        assert st_m["lastShotResult"] is not None
        assert not _filter_errors(errors), errors
    finally:
        ctx_m.close()
        ctx_s.close()


def test_e2e_ahududu_shell_games_lobby(live_server, browser):
    ctx_m = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True)
    ctx_s = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True)
    errors = []
    for ctx, tag in ((ctx_m, "murat"), (ctx_s, "selin")):
        ctx.add_init_script(f"localStorage.setItem('ahududu_user', '{tag}');")
    pm = ctx_m.new_page()
    ps = ctx_s.new_page()
    pm.on("pageerror", lambda e: errors.append(f"murat pageerror: {e}"))
    ps.on("pageerror", lambda e: errors.append(f"selin pageerror: {e}"))

    try:
        pm.goto(live_server + "/")
        ps.goto(live_server + "/")

        pm.get_by_label("Oyunlar").click()
        ps.get_by_label("Oyunlar").click()

        pm.wait_for_selector("[data-game-id='chess-duel']", timeout=8000)
        assert pm.locator("[data-game-id]").count() == 7

        # Kategori filtreleri (Aetheria kaldırıldığı için 'dünya' kategorisi yok)
        pm.locator("[data-category='strateji']").click()
        assert pm.locator("[data-game-id]").count() == 2
        pm.locator("[data-category='tumu']").click()
        assert pm.locator("[data-game-id]").count() == 7

        # Selin satranci acar -> Murat lobisinde canli kart belirir
        ps.locator("[data-game-id='chess-duel']").click()
        pm.wait_for_selector("text=Selin şu an Satranç Düellosu oynuyor", timeout=8000)

        # Selin oyun ici Davet tusuna basar -> Murat'ta davet bildirimi cikar
        ps.get_by_role("button", name="💌 Davet").click()
        toast = pm.locator("text=seni Satranç Düellosu oynamaya davet etti")
        toast.wait_for(state="visible", timeout=8000)

        # Murat davet bildirimine dokunur -> Satranc iframe'i acilir ve kopru uzerinden partnerOnline olur
        toast.click()
        pm.wait_for_selector("iframe[title='Satranç Düellosu']", timeout=8000)
        ps.wait_for_selector("iframe[title='Satranç Düellosu']", timeout=8000)

        def _wait_iframe_online(pg):
            deadline = time.time() + 10
            while time.time() < deadline:
                for fr in pg.frames:
                    if "/games/chess-duel/" in (fr.url or ""):
                        st = fr.evaluate("() => window.__ahududuTestMP ? window.__ahududuTestMP._getState() : null")
                        if st and st.get("partnerOnline") is True:
                            return st
                time.sleep(0.2)
            raise AssertionError("Iframe bridge partnerOnline did not become True in time")

        st_m = _wait_iframe_online(pm)
        st_s = _wait_iframe_online(ps)
        assert st_m["bridgeConfirmed"] is True
        assert st_s["bridgeConfirmed"] is True
        assert not _filter_errors(errors), errors
    finally:
        ctx_m.close()
        ctx_s.close()
