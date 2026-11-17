"""Live end-to-end check of the auto-update push on the Raspberry Pi deployment.

Connects a WebSocket client to the running server, then writes a new build id into
the running container (exactly what a real deploy does). Expects an `app_update`
message carrying the new build id, delivered without any client request.
"""

import asyncio
import json
import os
import sys
import time

import paramiko
import websockets

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

PI_HOST = "192.168.2.170"
PI_USER = "murat"
PI_PASS = os.getenv("AHUDUDU_PI_PASS", "")   # parola koda yazılmaz
WS_URL = f"ws://{PI_HOST}:33470/ws/murat"
BUILD_ID_FILE = "/app/backend/static/build-id.txt"


def write_build_id(ssh, build_id):
    cmd = f"docker exec ahududu-app sh -c 'echo {build_id} > {BUILD_ID_FILE}'"
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=30)
    out = stdout.read().decode("utf-8", errors="replace").strip()
    err = stderr.read().decode("utf-8", errors="replace").strip()
    status = stdout.channel.recv_exit_status()
    return out, err, status


def restore_build_id(ssh, build_id):
    cmd = f"docker exec ahududu-app sh -c 'echo {build_id} > {BUILD_ID_FILE}'"
    ssh.exec_command(cmd, timeout=30)


async def main():
    received = []
    new_build_id = str(int(time.time()))

    async with websockets.connect(WS_URL) as ws:
        print(f"WebSocket bağlandı: {WS_URL}")
        await ws.send(json.dumps({"type": "ping"}))
        pong = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
        print(f"Bağlantı doğrulandı: {pong}")

        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        ssh.connect(PI_HOST, username=PI_USER, password=PI_PASS, timeout=15)
        try:
            # Read the current id first so the test can restore it afterwards.
            stdin, stdout, _ = ssh.exec_command(
                f"docker exec ahududu-app cat {BUILD_ID_FILE}", timeout=30
            )
            original = stdout.read().decode("utf-8", errors="replace").strip()
            print(f"Mevcut build_id: {original}")

            out, err, status = write_build_id(ssh, new_build_id)
            print(f"Yeni build_id yazıldı: {new_build_id} (exit={status}) out={out!r} err={err!r}")

            started = time.time()
            while time.time() - started < 25:
                try:
                    message = await asyncio.wait_for(ws.recv(), timeout=3)
                except asyncio.TimeoutError:
                    continue
                data = json.loads(message)
                print(f"Gelen mesaj: {data}")
                if data.get("type") == "app_update":
                    received.append(data)
                    break

            if original:
                restore_build_id(ssh, original)
                print(f"Önceki build_id geri yazıldı: {original}")
        finally:
            ssh.close()

    print("\n=== CANLI OTOMATİK GÜNCELLEME TESTİ ===")
    if received and received[0].get("build_id") == new_build_id:
        print(f"[OK] app_update push alındı: build_id={received[0]['build_id']}")
        return 0
    if received:
        print(f"[FAIL] Push geldi ama build_id farklı: {received[0].get('build_id')} != {new_build_id}")
        return 1
    print("[FAIL] app_update mesajı alınmadı")
    return 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
