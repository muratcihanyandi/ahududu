"""Kapsamlı denetim regresyon testleri (yerel SQLite + FastAPI TestClient).

Çalıştırma:
    python tests/test_audit_regressions.py
"""

import asyncio
from datetime import datetime, timedelta
import os
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

TMP = tempfile.mkdtemp(prefix="ahududu_audit_test_")
os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///" + os.path.join(TMP, "audit.db")
os.environ["UPLOAD_DIR"] = os.path.join(TMP, "uploads")
os.environ["STATIC_DIR"] = os.path.join(ROOT, "frontend", "dist")

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from fastapi.testclient import TestClient  # noqa: E402

from backend.app.database import AsyncSessionLocal  # noqa: E402
from backend.app.main import app  # noqa: E402
from backend.app.models import DiaryEntry, LoveLetter, UserProfile  # noqa: E402
from backend.app.routes.cinema import set_cinema_presence  # noqa: E402
from backend.app.services import site_stream  # noqa: E402
from backend.app.time_utils import today_tr  # noqa: E402
from backend.app.websocket_manager import ws_manager  # noqa: E402

failures = []


def check(name: str, ok: bool, detail: str = ""):
    print(("[OK]   " if ok else "[FAIL] ") + name + (f" :: {detail}" if detail and not ok else ""))
    if not ok:
        failures.append(name)


def run_async(coro):
    return asyncio.run(coro)


def main():
    with TestClient(app) as client:
        # ------------------------------------------------------------------
        # 1. Sinema SSRF koruması (hls & proxy)
        # ------------------------------------------------------------------
        ssrf_targets = [
            "http://127.0.0.1:8000/api/auth/profiles",
            "http://localhost:8000/",
            "http://169.254.169.254/latest/meta-data/",
            "http://10.0.0.5/secret",
            "file:///etc/passwd",
        ]
        for bad_url in ssrf_targets:
            r_hls = client.get("/api/cinema/hls", params={"url": bad_url})
            r_proxy = client.get("/api/cinema/proxy", params={"url": bad_url})
            check(f"cinema_hls SSRF reddi ({bad_url})", r_hls.status_code in (400, 403), f"{r_hls.status_code} {r_hls.text[:120]}")
            check(f"cinema_proxy SSRF reddi ({bad_url})", r_proxy.status_code in (400, 403), f"{r_proxy.status_code} {r_proxy.text[:120]}")

        # ------------------------------------------------------------------
        # 2. Sinema ready-gate (solo + force), action=duration, pause/play
        # ------------------------------------------------------------------
        room_res = client.post(
            "/api/cinema",
            json={
                "title": "Regresyon Filmi",
                "video_url": "/uploads/test.mp4",
                "created_by": "murat",
                "kind": "file",
            },
        )
        check("sinema odası oluşturuldu", room_res.status_code == 200, room_res.text[:200])
        room_id = room_res.json()["id"]

        client.post(f"/api/cinema/{room_id}/start", json={"user_id": "murat"})
        ready_solo = client.post(
            f"/api/cinema/{room_id}/ready",
            json={"user_id": "murat", "position": 0, "force": False},
        )
        check(
            "partner çevrimdışıyken solo ready hemen başlatır",
            ready_solo.status_code == 200 and ready_solo.json().get("started") is True,
            ready_solo.text,
        )

        # force=true testi (partner çevrimiçi simüle edilirken)
        client.post(f"/api/cinema/{room_id}/start", json={"user_id": "murat"})
        ws_manager.active_connections["selin"] = [object()]
        try:
            ready_wait = client.post(
                f"/api/cinema/{room_id}/ready",
                json={"user_id": "murat", "position": 0, "force": False},
            )
            check(
                "partner çevrimiçiyken ilk ready bekler",
                ready_wait.status_code == 200 and ready_wait.json().get("waiting_for_partner") is True,
                ready_wait.text,
            )
            ready_force = client.post(
                f"/api/cinema/{room_id}/ready",
                json={"user_id": "murat", "position": 0, "force": True},
            )
            check(
                "force=true bekleyen odayı anında başlatır",
                ready_force.status_code == 200 and ready_force.json().get("started") is True,
                ready_force.text,
            )
        finally:
            ws_manager.active_connections.pop("selin", None)

        dur_res = client.post(
            f"/api/cinema/{room_id}/control",
            json={"user_id": "murat", "action": "duration", "duration": 725.5},
        )
        check(
            "action=duration süreyi kaydeder",
            dur_res.status_code == 200 and abs((dur_res.json().get("duration") or 0) - 725.5) < 0.1,
            dur_res.text,
        )

        pause_res = client.post(
            f"/api/cinema/{room_id}/control",
            json={"user_id": "murat", "action": "pause", "position": 120.0},
        )
        check(
            "pause durdurulan saniyeyi korur",
            pause_res.status_code == 200
            and pause_res.json().get("is_playing") is False
            and abs(pause_res.json().get("position", -1) - 120.0) < 0.1,
            pause_res.text,
        )

        # Hızlı izle play: yöneticinin (created_by=murat) saniyesini esas almalı
        client.post(
            f"/api/cinema/{room_id}/control",
            json={"user_id": "selin", "action": "pause", "position": 95.0},
        )
        play_res = client.post(
            f"/api/cinema/{room_id}/control",
            json={"user_id": "selin", "action": "play", "position": 95.0},
        )
        check(
            "hızlı izle play yöneticinin (murat=120.0) saniyesine eşitler",
            play_res.status_code == 200
            and play_res.json().get("is_playing") is True
            and abs(play_res.json().get("position", -1) - 120.0) < 0.5,
            play_res.text,
        )

        # ------------------------------------------------------------------
        # 3. Takvim seansı açıkken open_showtime sıfırlamaz, play geride olan - 3s, bilet iptal/presence
        # ------------------------------------------------------------------
        today = today_tr().isoformat()
        show_res = client.post(
            "/api/cinema/calendar",
            json={
                "title": "Takvim Regresyon",
                "video_url": "/uploads/cal.mp4",
                "show_date": today,
                "show_time": "21:30",
                "created_by": "murat",
            },
        )
        check("takvim seansı oluşturuldu", show_res.status_code == 200, show_res.text)
        show_id = show_res.json()["id"]

        client.post(f"/api/cinema/calendar/{show_id}/ticket", json={"user_id": "murat"})
        client.post(f"/api/cinema/calendar/{show_id}/ticket", json={"user_id": "selin"})
        opened1 = client.post(f"/api/cinema/calendar/{show_id}/open", json={"user_id": "murat"})
        check("takvim seansı açıldı", opened1.status_code == 200 and opened1.json().get("room_id"), opened1.text)
        cal_room_id = opened1.json()["room_id"]

        cal_seek = client.post(
            f"/api/cinema/{cal_room_id}/control",
            json={"user_id": "murat", "action": "seek", "position": 42.5},
        )
        check("takvim seansında sarma reddedilir (400)", cal_seek.status_code == 400, str(cal_seek.status_code))

        client.post(
            f"/api/cinema/{cal_room_id}/control",
            json={"user_id": "murat", "action": "pause", "position": 42.5},
        )
        opened2 = client.post(f"/api/cinema/calendar/{show_id}/open", json={"user_id": "selin"})
        check("ikinci kişi open_showtime başarılı", opened2.status_code == 200, opened2.text)
        cur_after = client.get("/api/cinema/current").json()
        check(
            "open_showtime aktif oda pozisyonunu (42.5) sıfırlamadı",
            cur_after and abs(cur_after.get("position", 0) - 42.5) < 0.1,
            str(cur_after),
        )

        # Takvim play: murat=120, selin=95 -> geride olan 95 - 3 = 92.0
        client.post(
            f"/api/cinema/{cal_room_id}/control",
            json={"user_id": "murat", "action": "pause", "position": 120.0},
        )
        client.post(
            f"/api/cinema/{cal_room_id}/control",
            json={"user_id": "selin", "action": "pause", "position": 95.0},
        )
        cal_play = client.post(
            f"/api/cinema/{cal_room_id}/control",
            json={"user_id": "murat", "action": "play", "position": 120.0},
        )
        check(
            "takvim play geride olanın 3sn gerisine (92.0) hizalar",
            cal_play.status_code == 200 and abs(cal_play.json().get("position", -1) - 92.0) < 0.5,
            cal_play.text,
        )

        cancel_res = client.delete(f"/api/cinema/calendar/{show_id}/ticket", params={"user_id": "selin"})
        check(
            "bilet iptali çalıştı",
            cancel_res.status_code == 200 and "selin" not in (cancel_res.json().get("booked_by") or ""),
            cancel_res.text,
        )

        # set_cinema_presence: sinema dışındaki custom status_text korunmalı
        client.put("/api/auth/profile/murat", json={"status_text": "Kahve içiyor"})

        async def _check_presence():
            await set_cinema_presence("murat", False)
            async with AsyncSessionLocal() as db:
                prof = await db.get(UserProfile, "murat")
                return prof.status_text if prof else None

        status_after = run_async(_check_presence())
        check("set_cinema_presence çıkışta sinema dışı durumu korudu", status_after == "Kahve içiyor", str(status_after))

        # ------------------------------------------------------------------
        # 4. site_stream döngü koruması
        # ------------------------------------------------------------------
        async def _check_cycle_cap():
            src_depth = await site_stream._fetch_embed(
                "https://example.com/a", "https://example.com/", client=None, depth=site_stream.MAX_DEPTH, visited=set()
            )
            src_seen = await site_stream._fetch_embed(
                "https://example.com/a", "https://example.com/", client=None, depth=0, visited={"https://example.com/a"}
            )
            return src_depth, src_seen

        depth_res, seen_res = run_async(_check_cycle_cap())
        check("site_stream MAX_DEPTH sınırını keser", not depth_res.ok, str(depth_res))
        check("site_stream tekrarlanan visited URL'yi keser", not seen_res.ok, str(seen_res))

        # ------------------------------------------------------------------
        # 5. Chat sayfalama (before_id + /count)
        # ------------------------------------------------------------------
        mids = []
        for idx in range(5):
            mr = client.post("/api/chat/messages", json={"sender": "murat", "message_type": "text", "content": f"m{idx}"})
            mids.append(mr.json()["id"])

        cnt_res = client.get("/api/chat/count")
        check("/api/chat/count toplam sayıyı döner", cnt_res.status_code == 200 and cnt_res.json().get("total", 0) >= 5, cnt_res.text)

        page_older = client.get("/api/chat/messages", params={"limit": 2, "before_id": mids[-1]})
        older_ids = [m["id"] for m in page_older.json()]
        check(
            "before_id sayfalama doğru iki mesajı artan sırada döner",
            older_ids == [mids[-3], mids[-2]],
            f"expected {[mids[-3], mids[-2]]}, got {older_ids}",
        )

        # ------------------------------------------------------------------
        # 6. Günlük kilit fail-closed, ortak kilitsiz, mood_score=0->1, viewer 403
        # ------------------------------------------------------------------
        d_locked = client.post(
            "/api/diary",
            json={
                "author": "murat",
                "title": "Gizli",
                "content": "Sır içerik",
                "photo_url": "/api/media/file/gizli.jpg",
                "is_locked": True,
                "mood_score": 0,
            },
        )
        check("kilitli günlük oluşturuldu & mood_score=0 -> 1 olarak alt sınıra çekildi (5 değil)", d_locked.status_code == 200 and d_locked.json()["mood_score"] == 1, d_locked.text)
        locked_id = d_locked.json()["id"]

        d_get_partner = client.get(f"/api/diary/{locked_id}", params={"viewer": "selin"})
        d_list_anon = [x for x in client.get("/api/diary").json() if x["id"] == locked_id][0]
        check(
            "kilitli sayfa tekil GET'te partnere 403 döner ve listede viewer olmadan fail-closed maskelenir",
            d_get_partner.status_code == 403
            and d_list_anon["content"] is None
            and d_list_anon["photo_url"] is None
            and d_list_anon["title"] == "Kilitli bir günlük 🔒",
            f"get={d_get_partner.status_code}, anon={d_list_anon}",
        )

        d_put_forbidden = client.put(
            f"/api/diary/{locked_id}",
            params={"viewer": "selin"},
            json={"title": "Değişti"},
        )
        d_del_forbidden = client.delete(f"/api/diary/{locked_id}", params={"viewer": "selin"})
        check("partner kilitli günlüğü PUT edemez (403)", d_put_forbidden.status_code == 403, str(d_put_forbidden.status_code))
        check("partner başkasının günlüğünü DELETE edemez (403)", d_del_forbidden.status_code == 403, str(d_del_forbidden.status_code))

        d_ortak = client.post(
            "/api/diary",
            json={"author": "ortak", "title": "Ortak", "content": "Açık", "is_locked": True},
        )
        check("author=ortak is_locked=False zorlanır", d_ortak.status_code == 200 and d_ortak.json()["is_locked"] is False, d_ortak.text)

        # ------------------------------------------------------------------
        # 7. Bahçe URL şeması ve On-This-Day gizlilik filtresi
        # ------------------------------------------------------------------
        bad_song = client.post(
            "/api/garden/songs",
            json={"added_by": "murat", "title": "XSS", "url": "javascript:alert(1)"},
        )
        check("javascript: şarkı URL'si reddedildi (400)", bad_song.status_code == 400, bad_song.text)

        good_song = client.post(
            "/api/garden/songs",
            json={"added_by": "murat", "title": "Safe", "url": "https://open.spotify.com/track/123"},
        )
        check("https şarkı URL'si kabul edildi", good_song.status_code == 200, good_song.text)

        # Geçmiş yıl verisi ekle: kilitli günlük, silinmiş mektup ve mühürlü mektup on-this-day'e düşmemeli
        last_year_date = today_tr().replace(year=today_tr().year - 1)
        last_year_iso = last_year_date.isoformat()
        last_year_dt = datetime(last_year_date.year, last_year_date.month, last_year_date.day, 12, 0, 0)

        async def _seed_last_year():
            async with AsyncSessionLocal() as db:
                db.add(DiaryEntry(
                    author="murat", title="Geçen Yıl Kilitli", content="Gizli",
                    entry_date=last_year_iso, is_locked=True, created_at=last_year_dt - timedelta(hours=3),
                ))
                db.add(DiaryEntry(
                    author="murat", title="Geçen Yıl Açık", content="Açık anı",
                    entry_date=last_year_iso, is_locked=False, created_at=last_year_dt - timedelta(hours=3),
                ))
                db.add(LoveLetter(
                    sender="murat", title="Silinmiş Mektup", content_text="Yok",
                    is_deleted=True, is_opened=True, created_at=last_year_dt - timedelta(hours=3),
                ))
                db.add(LoveLetter(
                    sender="murat", title="Mühürlü Mektup", content_text="Henüz açılmadı",
                    is_deleted=False, is_opened=False, created_at=last_year_dt - timedelta(hours=3),
                ))
                await db.commit()

        run_async(_seed_last_year())
        otd = client.get("/api/garden/on-this-day").json()
        otd_titles = [item.get("title") for item in otd.get("items", [])]
        check(
            "on_this_day kilitli günlüğü ve silinmiş/mühürlü mektupları hariç tutar",
            "Geçen Yıl Açık" in otd_titles
            and "Geçen Yıl Kilitli" not in otd_titles
            and "Silinmiş Mektup" not in otd_titles
            and "Mühürlü Mektup" not in otd_titles,
            str(otd_titles),
        )

        # ------------------------------------------------------------------
        # 8. Mektup open_letter viewer & is_sealed=False
        # ------------------------------------------------------------------
        let_res = client.post(
            "/api/letters",
            json={"sender": "murat", "title": "Mühür Test", "content_text": "Sevgiler"},
        )
        lid = let_res.json()["id"]
        sender_open = client.post(f"/api/letters/{lid}/open", params={"viewer": "murat"})
        check(
            "gönderenin kendi mektubunu önizlemesi mührü açmaz",
            sender_open.status_code == 200 and sender_open.json()["is_opened"] is False and sender_open.json()["is_sealed"] is True,
            sender_open.text,
        )
        partner_open = client.post(f"/api/letters/{lid}/open", params={"viewer": "selin"})
        check(
            "partnerin açması mührü kırar (is_opened=True, is_sealed=False)",
            partner_open.status_code == 200 and partner_open.json()["is_opened"] is True and partner_open.json()["is_sealed"] is False,
            partner_open.text,
        )

        # ------------------------------------------------------------------
        # 9. Medya yükleme güvenli uzantı & inline XSS engeli
        # ------------------------------------------------------------------
        up_html = client.post(
            "/api/media/upload",
            files={"file": ("evil.html", b"<script>alert(1)</script>", "text/html")},
            data={"media_category": "general"},
        )
        check(
            "html upload .bin uzantısına düşürülür",
            up_html.status_code == 200 and up_html.json()["filename"].endswith(".bin"),
            up_html.text,
        )
        up_svg = client.post(
            "/api/media/upload",
            files={"file": ("icon.svg", b"<svg onload=alert(1)/>", "image/svg+xml")},
            data={"media_category": "general"},
        )
        check(
            "svg upload .bin olarak saklanır ve inline sunulmaz",
            up_svg.status_code == 200 and up_svg.json()["filename"].endswith(".bin"),
            up_svg.text,
        )
        dl_res = client.get(up_html.json()["url"])
        cd = dl_res.headers.get("content-disposition", "")
        check(
            "tehlikeli medya attachment olarak sunulur",
            dl_res.status_code == 200 and "attachment" in cd.lower(),
            f"headers={dict(dl_res.headers)}",
        )

        # ------------------------------------------------------------------
        # 10. Snap viewer kontrolü
        # ------------------------------------------------------------------
        snap_res = client.post(
            "/api/snaps",
            json={"sender": "murat", "media_url": "/api/media/file/test.jpg", "media_type": "image"},
        )
        sid = snap_res.json()["id"]
        seen_self = client.post(f"/api/snaps/{sid}/seen", params={"viewer": "murat"})
        check("gönderen kendi snapini gördüğünde is_seen açılmaz", seen_self.json()["is_seen"] is False, seen_self.text)
        seen_partner = client.post(f"/api/snaps/{sid}/seen", params={"viewer": "selin"})
        check("partner snapı görünce is_seen=True olur", seen_partner.json()["is_seen"] is True, seen_partner.text)

    if failures:
        print(f"\nTOPLAM {len(failures)} BASARISIZ TEST: {failures}")
        sys.exit(1)
    print("\nTUM DENETIM REGRESYON TESTLERI GECTI.")


if __name__ == "__main__":
    main()
