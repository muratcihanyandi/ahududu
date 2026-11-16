"""Ahududu — metin/statik kabul testleri.

Bu test tarayıcı gerektirmez; kaynak dosyalarda kullanıcıya görünen metinleri
ve yapılandırma kanıtlarını kontrol eder.

Kullanım:
    python tests/test_static_copy.py
"""

import os
import re
import sys

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "frontend", "src")

failures = []
checks = 0


def log(name, ok, detail=""):
    global checks
    checks += 1
    print(("[OK]   " if ok else "[FAIL] ") + name + (f" :: {detail}" if detail and not ok else ""))
    if not ok:
        failures.append(name)


def read(rel_path):
    path = os.path.join(SRC, rel_path)
    if not os.path.isfile(path):
        return ""
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        return f.read()


def all_ts():
    chunks = []
    for base, _dirs, files in os.walk(SRC):
        for name in files:
            if name.endswith((".ts", ".tsx", ".css")):
                with open(os.path.join(base, name), "r", encoding="utf-8", errors="replace") as f:
                    chunks.append((name, f.read()))
    return chunks


def main():
    # ---------------------------------------------------------------- görev 7
    # Kullanıcının kaldırılmasını istediği tanıtım cümleleri arayüzde olmamalı.
    banned_phrases = [
        "Her siteden video",
        "her siteden video",
        "telefon yatay",
        "Telefon otomatik yatay",
        "ikiniz birlikte, aynı saniyede",
        "Büyük Güncelleme",
        "aynı saniyeden başla",
        "Yatay mod",
        "DEMO",
    ]
    for name, text in all_ts():
        for phrase in banned_phrases:
            # JSX'te görünen metin olarak geçmemeli. Yorum satırları da sayılır:
            # kullanıcı "bu tarz yazılar" deyince kaynakta da bırakmıyoruz.
            if phrase in text:
                line_no = text[: text.index(phrase)].count("\n") + 1
                log(f"tanıtım metni yok: {name}:{line_no} '{phrase}'", False)
            else:
                log(f"tanıtım metni yok: {name} '{phrase}'", True)

    # ---------------------------------------------------------------- görev 8
    app_tsx = read("App.tsx")
    more_hub = read("components/MoreHub.tsx")
    radar = read("components/CoupleRadar.tsx")
    log("Neredeyiz? başlığı App.tsx'te var", "Neredeyiz?" in app_tsx)
    log("MoreHub'da Neredeyiz? var", "Neredeyiz?" in more_hub)
    log("MoreHub'da 'Çift Radarı' kalmadı", "Çift Radarı" not in more_hub)
    log("CoupleRadar'da 'Çift Radarı' kalmadı", "Çift Radarı" not in radar)

    # ---------------------------------------------------------------- görev 5
    pets = read("components/PetAlbum.tsx")
    log("PetAlbum'da 'Kimin dostu?' duruyor", "Kimin dostu?" in pets)
    log(
        "PetAlbum'da Murat/Selin sahip seçeneği yok",
        "label: '🐻 Murat'" not in pets and "label: '🌸 Selin'" not in pets,
    )
    log("PetAlbum'da 'Bizim' seçeneği var", "💞 Bizim" in pets)

    # ---------------------------------------------------------------- görev 1
    nav = read("components/Navigation.tsx")
    chat = read("components/ChatView.tsx")
    log("Navigation 'attached' varyantını destekliyor", "attached" in nav)
    log("ChatView kart yüksekliği (100dvh - 210px) kaldırıldı", "100dvh - 210px" not in chat)
    log("ChatView flex-1 min-h-0 iskeleti", "flex-1" in chat and "min-h-0" in chat)

    # ---------------------------------------------------------------- görev 2
    log("ChatView'da basılı tutma (pointerdown) mantığı", "onPointerDown" in chat or "pointerDown" in chat)
    log("ChatView'da iptal sürüklemesi (cancel threshold)", "cancel" in chat.lower())

    # ---------------------------------------------------------------- görev 3
    cinema = read("components/CinemaSalon.tsx")
    sync = read("services/cinemaSync.ts")
    stage = read("components/CinemaStage.tsx")
    player = read("services/youtubePlayer.ts")
    log("Sinema YouTube IFrame API kullanıyor", "iframe_api" in stage or "iframe_api" in player)
    log("Sinema RTT/gecikme telafisi içeriyor", "latency" in sync.lower() or "rtt" in sync.lower())
    log("Sinema kademeli düzeltme/seek cooldown", "cooldown" in sync.lower())
    log("Sinema kuyruk (Sırada) paneli", "Sırada" in cinema or "sırada" in cinema)

    # ---------------------------------------------------------------- görev 4
    notif = read("services/notifications.ts")
    native = read("services/nativeNotify.ts")
    java_dir = os.path.join(ROOT, "frontend", "android", "app", "src", "main", "java", "com", "ahududu", "app")
    java_files = os.listdir(java_dir) if os.path.isdir(java_dir) else []
    manifest = os.path.join(ROOT, "frontend", "android", "app", "src", "main", "AndroidManifest.xml")
    manifest_text = open(manifest, "r", encoding="utf-8", errors="replace").read() if os.path.isfile(manifest) else ""
    log("Native bildirim servisi Java dosyası var", any("NotifyService" in f for f in java_files), str(java_files))
    log(
        "Native bildirim köprüsü (plugin) var",
        any("NotificationsBridge" in f for f in java_files),
        str(java_files),
    )
    log("Manifest'te servis tanımlı", "service" in manifest_text and "NotifyService" in manifest_text)
    log("Manifest'te FOREGROUND_SERVICE izni", "FOREGROUND_SERVICE" in manifest_text)
    log("nativeNotify.ts servisi var", "startNativeNotifications" in native)
    log("notifications.ts native servisle çift bildirim yapmıyor", "native" in notif.lower())

    print(f"\n{checks - len(failures)}/{checks} kontrol geçti.")
    if failures:
        print("BAŞARISIZ:", ", ".join(failures))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
