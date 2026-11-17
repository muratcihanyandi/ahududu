"""Sohbet başlığındaki çevrimiçi / son görülme satırının doğrulanması.

Yerel dev sunucusu gerekli:
    $env:PORT=33478; python tests/dev_server.py
    python tests/verify_chat_presence.py

Kontroller:
  1. Eski "Kalplerimiz bağlı" yazısı artık görünmüyor.
  2. Boş sohbette "burada sadece ikimiz varız" yazısı yok.
  3. Partner çevrimdışıyken "son görülme ..." yazısı görünüyor.
  4. Partner WebSocket'e bağlanınca satır "çevrimiçi" oluyor.
  5. Partner ayrılınca yeniden son görülmeye dönüyor ve saat güncelleniyor.

Kanıtlar: tests/screenshots_verify/presence_*.png
"""

import asyncio
import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timezone

from playwright.sync_api import sync_playwright

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = os.getenv("AHUDUDU_VERIFY_BASE", "http://127.0.0.1:33478")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "tests", "screenshots_verify")
os.makedirs(OUT, exist_ok=True)

failures = []


def log(name, ok, detail=""):
    print(("[OK]   " if ok else "[FAIL] ") + name + (f" :: {detail}" if detail else ""))
    if not ok:
        failures.append(name)


def api(path, method="GET", data=None):
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(
        f"{BASE}{path}", data=body, method=method,
        headers={"Content-Type": "application/json"} if body else {},
    )
    with urllib.request.urlopen(req, timeout=10) as res:
        raw = res.read().decode()
        return json.loads(raw) if raw else None


def reset_chat():
    """Boş sohbet senaryosunu garantile."""
    import sqlite3
    import tempfile

    db = os.path.join(tempfile.gettempdir(), "ahududu_dev.db")
    con = sqlite3.connect(db)
    con.execute("DELETE FROM chat_messages")
    con.commit()
    con.close()


async def _open_partner_socket(seconds: float, holder: dict):
    """Partner (selin) adına gerçek bir WebSocket aç ve belirtilen süre tut."""
    import websockets

    url = BASE.replace("http://", "ws://") + "/ws/selin"
    async with websockets.connect(url) as ws:
        holder["connected"] = True
        # Sunucu hiçbir şey göndermezse recv bloklar; süre dolunca iptal edilir
        # ve with bloğu çıkışında soket temiz biçimde kapanır.
        try:
            await asyncio.wait_for(ws.recv(), timeout=seconds)
        except (asyncio.TimeoutError, Exception):
            pass
    holder["connected"] = False


def partner_online(seconds: float, holder: dict):
    """Playwright sync API kendi event loop'unu çalıştırdığı için ayrı thread'de aç."""
    import threading

    def runner():
        asyncio.run(_open_partner_socket(seconds, holder))

    thread = threading.Thread(target=runner, daemon=True)
    thread.start()
    # Bağlantının kurulmasını bekle.
    for _ in range(50):
        if holder.get("connected"):
            break
        threading.Event().wait(0.1)
    holder["thread"] = thread
    return thread


def subtitle_text(page) -> str:
    return page.evaluate(
        """() => {
            const root = document.querySelector('[data-chat-root="true"]');
            if (!root) return '';
            const span = root.querySelector('div.shrink-0 span');
            return span ? span.textContent.trim() : '';
        }"""
    )


def set_last_seen_minutes_ago(user_id: str, minutes: int):
    """Partner'in son görülme zamanını bilinen bir geçmiş ana sabitler."""
    import sqlite3
    import tempfile
    from datetime import datetime, timedelta, timezone

    value = (datetime.now(timezone.utc) - timedelta(minutes=minutes)).strftime(
        "%Y-%m-%d %H:%M:%S.%f"
    )
    db = os.path.join(tempfile.gettempdir(), "ahududu_dev.db")
    con = sqlite3.connect(db)
    con.execute("UPDATE user_profiles SET last_seen = ? WHERE id = ?", (value, user_id))
    con.commit()
    con.close()
    return value


def main() -> int:
    reset_chat()

    # Partner'in son görülmesini bilinen bir ana sabitle (25 dk önce).
    stamped = set_last_seen_minutes_ago("selin", 25)
    print(f"[..]   sohbet sıfırlandı; selin.last_seen = {stamped} (UTC, 25 dk önce)")

    with sync_playwright() as p:
        browser = None
        for channel in ("chrome", "msedge"):
            try:
                browser = p.chromium.launch(channel=channel)
                print(f"[OK]   tarayıcı: {channel}")
                break
            except Exception as exc:  # noqa: BLE001
                print(f"[..]   {channel}: {str(exc)[:80]}")
        if browser is None:
            print("[FAIL] tarayıcı yok")
            return 1

        ctx = browser.new_context(viewport={"width": 412, "height": 915}, device_scale_factor=1)
        page = ctx.new_page()
        page.goto(BASE, wait_until="networkidle")
        page.evaluate("localStorage.setItem('ahududu_user','murat')")
        page.reload(wait_until="networkidle")
        page.wait_for_timeout(1500)

        page.get_by_role("button", name="Sohbet").first.click()
        page.wait_for_timeout(1800)
        page.screenshot(path=os.path.join(OUT, "presence_01_offline.png"))

        body_text = page.evaluate("() => document.body.innerText")

        # 1) Eski metinler gitti mi?
        log("\"Kalplerimiz bağlı\" artık yok", "Kalplerimiz bağlı" not in body_text)
        log(
            "\"Burada sadece ikimiz varız\" artık yok",
            "burada sadece ikimiz" not in body_text.lower(),
        )

        # 2) Çevrimdışı: son görülme tarih-saat olarak yazılıyor
        offline_sub = subtitle_text(page)
        print(f"[..]   çevrimdışı satır: {offline_sub!r}")
        log("çevrimdışıyken 'Son görülme' yazıyor", "son görülme" in offline_sub.lower(), offline_sub)
        # Beklenen biçim: "Son görülme 17.11.2026 03:34"
        pattern = r"^Son görülme \d{2}\.\d{2}\.\d{4} \d{2}:\d{2}$"
        log(
            "tarih-saat biçimi doğru (gg.aa.yyyy ss:dd)",
            re.match(pattern, offline_sub) is not None,
            offline_sub,
        )
        # 25 dk önce damgalanan değer yerel saatle aynı dakikayı göstermeli.
        expected = datetime.strptime(stamped, "%Y-%m-%d %H:%M:%S.%f").replace(
            tzinfo=timezone.utc
        ).astimezone()
        expected_text = expected.strftime("Son görülme %d.%m.%Y %H:%M")
        log("saat dilimi doğru çevrildi", offline_sub == expected_text, f"{offline_sub} != {expected_text}")
        # 3) Partner bağlansın -> çevrimiçi
        holder = {}
        partner_online(4.0, holder)
        page.wait_for_timeout(1200)
        online_sub = subtitle_text(page)
        print(f"[..]   çevrimiçi satır: {online_sub!r}")
        log("partner bağlanınca 'çevrimiçi'", "çevrimiçi" in online_sub.lower(), online_sub)
        page.screenshot(path=os.path.join(OUT, "presence_02_online.png"))

        # 4) Partner ayrılsın -> tekrar son görülme (taze ayrılış = şimdiki saat)
        holder["thread"].join(timeout=10)
        page.wait_for_timeout(1800)
        after_sub = subtitle_text(page)
        print(f"[..]   ayrıldıktan sonra: {after_sub!r}")
        log(
            "partner ayrılınca tarih-saatli son görülmeye dönüldü",
            re.match(pattern, after_sub) is not None,
            after_sub,
        )
        # Ayrılış anı "şimdi" olmalı: dakika farkı 0 veya 1.
        now_local = datetime.now()
        got = datetime.strptime(after_sub.replace("Son görülme ", ""), "%d.%m.%Y %H:%M")
        log(
            "ayrılış anı güncel saat olarak yazıldı",
            abs((now_local - got).total_seconds()) <= 120,
            after_sub,
        )
        page.screenshot(path=os.path.join(OUT, "presence_03_after.png"))

        ctx.close()
        browser.close()

    print(f"\n{len(failures)} hata")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
