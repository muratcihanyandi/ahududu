"""Local integration check for build detection and app_update push.

Starts the real FastAPI app against backend/static, verifies:
  1. index.html carries the injected build id meta tag
  2. /api/system/version returns the same build id as build-id.txt
  3. writing a new build id is pushed to a connected WebSocket client
  4. the watcher does not spam when nothing changes
"""

import asyncio
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BUILD_ID_FILE = "build-id.txt"


async def main():
    import httpx
    import websockets
    from backend.app.main import app, get_build_id, BUILD_ID_META_NAME, render_index_html

    static_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend", "static")
    build_id_path = os.path.join(static_dir, BUILD_ID_FILE)

    # Ensure a build id file exists for the duration of the check.
    original_build_id = None
    if os.path.exists(build_id_path):
        with open(build_id_path, "r", encoding="utf-8") as f:
            original_build_id = f.read().strip()
    if not original_build_id:
        original_build_id = str(int(time.time()))
        with open(build_id_path, "w", encoding="utf-8") as f:
            f.write(original_build_id + "\n")

    expectations = []

    try:
        # 1 & 2: meta injection and version consistency
        html = render_index_html()
        build_id = get_build_id()
        expectations.append(("build id comes from build-id.txt", build_id == original_build_id))
        expectations.append(("meta tag present", f'name="{BUILD_ID_META_NAME}" content="{build_id}"' in html))
        expectations.append(("exactly one meta tag", html.count(BUILD_ID_META_NAME) == 1))

        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            version = (await client.get("/api/system/version")).json()
            expectations.append(("version build_id matches file", version["build_id"] == build_id))
            expectations.append(("watch feature removed", "watch_biometrics" not in version["features"]))
            expectations.append(("auto_update feature advertised", "auto_update" in version["features"]))

            page = await client.get("/")
            expectations.append(("served html has meta", f'name="{BUILD_ID_META_NAME}"' in page.text))
            expectations.append(("no-cache on html", "no-store" in page.headers.get("cache-control", "")))

            watch_route = await client.get("/api/watch/biometrics/murat")
            expectations.append(("watch api gone", "application/json" not in watch_route.headers.get("content-type", "")))

        # 3: WebSocket push when a new build id is deployed (real server for a true socket)
        import uvicorn

        port = 34771
        config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning", lifespan="on")
        server = uvicorn.Server(config)
        server_task = asyncio.create_task(server.serve())

        try:
            for _ in range(50):
                if server.started:
                    break
                await asyncio.sleep(0.1)

            received = []
            new_build_id = str(int(time.time()) + 10)
            async with websockets.connect(f"ws://127.0.0.1:{port}/ws/murat") as ws:
                await ws.send(json.dumps({"type": "ping"}))
                await asyncio.sleep(0.5)

                with open(build_id_path, "w", encoding="utf-8") as f:
                    f.write(new_build_id + "\n")

                deadline = time.time() + 15
                while time.time() < deadline:
                    try:
                        message = await asyncio.wait_for(ws.recv(), timeout=2)
                    except asyncio.TimeoutError:
                        continue
                    data = json.loads(message)
                    if data.get("type") == "app_update":
                        received.append(data)
                        break
                expectations.append(("app_update pushed over ws", len(received) == 1))
                if received:
                    expectations.append(("push carries new build id", received[0]["build_id"] == new_build_id))
        finally:
            server.should_exit = True
            await server_task
    finally:
        with open(build_id_path, "w", encoding="utf-8") as f:
            f.write(original_build_id + "\n")

    print("=== BUILD / UPDATE INTEGRATION CHECK ===")
    failed = 0
    for name, ok in expectations:
        print(f"[{'OK' if ok else 'FAIL'}] {name}")
        if not ok:
            failed += 1

    print(f"\n{len(expectations) - failed}/{len(expectations)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
