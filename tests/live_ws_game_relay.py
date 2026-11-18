"""Canli sunucuda WebSocket oyun rolesini dener (deploy sonrasi dogrulama).

murat -> selin: game_hello / game_car / game_countdown / game_mic
Beklenen: paketler partnere ulasir, game_car'in 'data' alani dusurulur,
gonderen kendi paketini geri ALMAZ (ayni kimlikle iki soket acilmadigi surece).
"""
import asyncio
import json
import os
import sys

import websockets

BASE = os.getenv("AHUDUDU_BASE", "http://192.168.2.170:33470")
HOST = BASE.replace("https://", "").replace("http://", "").rstrip("/")
PROTO = "wss" if BASE.startswith("https") else "ws"


async def main() -> int:
    recv = {"murat": [], "selin": []}

    async def pump(ws, user):
        try:
            async for raw in ws:
                recv[user].append(json.loads(raw))
        except Exception:
            pass

    async with websockets.connect(f"{PROTO}://{HOST}/ws/murat", open_timeout=15) as m, \
            websockets.connect(f"{PROTO}://{HOST}/ws/selin", open_timeout=15) as s:
        tasks = [asyncio.create_task(pump(m, "murat")), asyncio.create_task(pump(s, "selin"))]
        await asyncio.sleep(0.4)
        await m.send(json.dumps({"type": "game_hello", "game": "uno-com-escada"}))
        await m.send(json.dumps({"type": "game_car",
                                 "d": [1.5, 2.5, 3.5, 0.4, 12.25, 3, 1, 40.2, -1.1]}))
        await m.send(json.dumps({"type": "game_countdown", "game": "uno-com-escada",
                                 "at": 1700000000000, "from": "murat"}))
        await m.send(json.dumps({"type": "game_mic", "data": "AAAA"}))
        await asyncio.sleep(0.8)
        await s.send(json.dumps({"type": "game_hello", "game": "uno-com-escada"}))
        await asyncio.sleep(0.8)
        for t in tasks:
            t.cancel()
        await asyncio.sleep(0.05)

    st = [p.get("type") for p in recv["selin"]]
    mt = [p.get("type") for p in recv["murat"]]
    print("selin received:", st)
    print("murat received:", mt)

    hello = next((p for p in recv["selin"] if p.get("type") == "game_hello"), None)
    car = next((p for p in recv["selin"] if p.get("type") == "game_car"), None)
    print("game_car:", json.dumps(car))

    checks = {
        "game_hello partnere ulasti": bool(hello) and hello.get("from") == "murat",
        "game_car partnere ulasti": bool(car) and car.get("d", [None, None])[1] == 2.5,
        "game_car 'data' alani dusuruldu": bool(car) and "data" not in car,
        "game_countdown partnere ulasti": "game_countdown" in st,
        "game_mic partnere ulasti": "game_mic" in st,
        # NOT: eski sürümü çalışan bir telefon açıksa sunucudan bize de bir
        # game_hello gelebilir (partnerin kendi oyunu kendini tanıtıyor). Bu
        # yüzden kontrol "hiç game_ paketi gelmemesi" değil, "sunucunun bize
        # ECHO yapmaması": bizim gönderdiğimiz paket kimliği geri dönmemeli.
        "sunucu gondereni yankilamiyor (echo yok)":
            not any(p.get("type") == "game_car" and p.get("from") == "murat" for p in recv["murat"]),
        "selin kendi hello'sunu geri almiyor": st.count("game_hello") == 1,
    }
    ok = True
    for name, val in checks.items():
        print(("PASS  " if val else "FAIL  ") + name)
        ok = ok and val
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
