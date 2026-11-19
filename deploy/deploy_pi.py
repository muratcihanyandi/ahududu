"""Ahududu tek komut dağıtım zinciri.

    python deploy/deploy_pi.py

Sırasıyla:
  1. Frontend'i derler (npm run build) -> frontend/dist
  2. dist içeriğini backend/static'e senkronize eder (eski hash'li paketleri temizler)
  3. Kaynağı Raspberry Pi 5'e yükler, Docker imajını yerinde derler, container'ı yeniler
  4. Canlı build_id ile yerel index.html'in eşleştiğini doğrular

Telefon uygulaması Pi'deki web arayüzünü yüklediği için bu adımlar sonrasında
yeni sürüm, APK yeniden kurulmadan istemcilere dağıtılmış olur.
"""

import argparse
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.request

import paramiko

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import config  # noqa: E402  (deploy/config.py: parola koda yazılmaz)

# Ensure safe printing on Windows terminals
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

PI_HOST = os.getenv("AHUDUDU_PI_HOST", "192.168.2.170")
PI_USER = os.getenv("AHUDUDU_PI_USER", "murat")
# SSH parolası koda YAZILMAZ (depo herkese açık): ortam değişkeni ya da .env
PI_PASS = ""   # deploy_to_pi() içinde config.require_password_or_exit() ile doldurulur
PORT = int(os.getenv("AHUDUDU_PORT", "33470"))

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR = os.path.join(ROOT_DIR, "frontend")
FRONTEND_DIST = os.path.join(FRONTEND_DIR, "dist")
STATIC_DIR = os.path.join(ROOT_DIR, "backend", "static")
BUILD_ID_FILE = "build-id.txt"

HEALTH_ATTEMPTS = 20
HEALTH_DELAY_SECONDS = 3


def step(message):
    print(f"\n=== {message} ===")


def run_local(command, cwd=None):
    print(f"$ {' '.join(command)}")
    subprocess.run(command, cwd=cwd, check=True, shell=(os.name == "nt"))


def ensure_game_bundles():
    """Oyun paketlerini KAYNAKTAN yeniden üret (source/**.js -> index.html).

    Oyunlar `frontend/public/games/<ad>/source/` içinde parçalı durur ve tek bir
    `index.html` içine gömülür. Kaynak değişip paket yenilenmezse canlıda ESKİ
    oyun çalışır (bir kez tam olarak bu yaşandı). Bu yüzden frontend derlemesi
    ve `--update-only` dahil her dağıtımda önce paket üretilir.
    """
    games_root = os.path.join(FRONTEND_DIR, "public", "games")
    if not os.path.isdir(games_root):
        return
    node = shutil.which("node") or "node"
    built = 0
    for name in sorted(os.listdir(games_root)):
        build_script = os.path.join(games_root, name, "source", "build.mjs")
        if not os.path.isfile(build_script):
            continue
        step(f"Oyun paketi üretiliyor: {name}")
        bundle = os.path.join(games_root, name, "index.html")
        run_local([node, build_script, "--out", bundle], cwd=ROOT_DIR)
        if not os.path.isfile(bundle):
            raise RuntimeError("Oyun paketi üretilemedi: " + bundle)
        built += 1
    if not built:
        print("(yeniden üretilecek oyun paketi bulunamadı)")


def build_frontend():
    ensure_game_bundles()
    step("Frontend derleniyor")
    npm = shutil.which("npm") or "npm.cmd"
    run_local([npm, "run", "build"], cwd=FRONTEND_DIR)
    if not os.path.isfile(os.path.join(FRONTEND_DIST, "index.html")):
        raise RuntimeError("Frontend derlemesi index.html üretmedi.")


def new_build_id():
    """Yeni derleme kimliği: şu anki saniyeden her zaman BÜYÜK.

    Eski davranış (int(time.time())) aynı saniye içinde yapılan iki dağıtımda
    aynı kimliği üretebiliyordu; o durumda `wait_for_health` eski container'ı
    "doğrulanmış" sayıp dağıtımı tamamlanmış gibi gösteriyordu.
    """
    candidates = [int(time.time())]
    try:
        candidates.append(int(local_build_id()) + 1)
    except (TypeError, ValueError):
        pass
    return str(max(candidates))


def sync_static():
    step("backend/static senkronize ediliyor")
    if not os.path.isdir(FRONTEND_DIST):
        raise RuntimeError("frontend/dist bulunamadı. Önce derleme yapılmalı.")

    assets_dir = os.path.join(STATIC_DIR, "assets")
    if os.path.isdir(assets_dir):
        shutil.rmtree(assets_dir)

    os.makedirs(STATIC_DIR, exist_ok=True)
    for name in os.listdir(FRONTEND_DIST):
        source = os.path.join(FRONTEND_DIST, name)
        target = os.path.join(STATIC_DIR, name)
        if os.path.isdir(source):
            if os.path.isdir(target):
                shutil.rmtree(target)
            shutil.copytree(source, target)
        else:
            shutil.copy(source, target)

    # Build kimliği: imaj katmanları dosya zaman damgasını korumadığı için,
    # kimliği açıkça dosyaya yazıyoruz ve backend onu okuyor. Yeni kimlik her
    # zaman eskisinden büyüktür (aynı saniyedeki iki dağıtım çakışmaz).
    index_file = os.path.join(STATIC_DIR, "index.html")
    now = time.time()
    os.utime(index_file, (now, now))

    build_id = new_build_id()
    with open(os.path.join(STATIC_DIR, BUILD_ID_FILE), "w", encoding="utf-8") as f:
        f.write(build_id + "\n")

    asset_count = len(os.listdir(assets_dir)) if os.path.isdir(assets_dir) else 0
    print(f"index.html ve {asset_count} asset kopyalandı. build_id={build_id}")
    return build_id


def local_build_id():
    build_id_path = os.path.join(STATIC_DIR, BUILD_ID_FILE)
    if os.path.exists(build_id_path):
        with open(build_id_path, "r", encoding="utf-8") as f:
            value = f.read().strip()
        if value:
            return value

    index_file = os.path.join(STATIC_DIR, "index.html")
    return str(int(os.path.getmtime(index_file)))


def game_bundle_digest():
    """Derlenmiş oyun paketinin (uno-com-escada) SHA256 özeti.

    Yalnızca build_id'e bakmak yetmez: bir oyun kaynağı değişip `index.html`
    yeniden üretilmezse build_id yine eşleşir ama canlıda ESKİ oyun çalışır.
    (Bir kez tam olarak bu yaşandı: 47_perf.js'in başındaki BOM işareti oyun
    paketini bozuyordu, paket hiç yenilenmemişti.) Bu özet dağıtımdan sonra
    canlı sunucudan okunup yerelle karşılaştırılır.

    Sıralama ve özet biçimi `remote_game_bundle_digest` ile BİREBİR aynıdır;
    aksi hâlde aynı dosyalar farklı özet üretir.
    """
    import hashlib

    root = os.path.join(STATIC_DIR, "games")
    entries = []
    for dirpath, _dirnames, filenames in os.walk(root):
        for name in filenames:
            if not (name.endswith(".html") or name.endswith(".js")):
                continue
            path = os.path.join(dirpath, name)
            rel = "./" + os.path.relpath(path, root).replace("\\", "/")
            with open(path, "rb") as f:
                entries.append((rel, hashlib.sha256(f.read()).hexdigest()))
    digest = hashlib.sha256()
    for rel, file_hash in sorted(entries, key=lambda x: x[0]):
        digest.update(rel.encode("utf-8"))
        digest.update(bytes.fromhex(file_hash))
    return digest.hexdigest()


def remote_game_bundle_digest():
    """Canlı sunucudaki oyun paketlerinin özeti (container içindeki games/ ağacı).

    Dağıtım sonrası Pi'deki (canlı container) dosyalarla yereldeki
    `backend/static/games` karşılaştırılır; böylece "build_id tuttu ama oyun
    eski paketi sunuyor" durumu yakalanır.
    """
    import hashlib
    import shlex

    ssh, _ = config.connect_ssh()
    try:
        inner = (
            "cd /app/backend/static/games 2>/dev/null && find . -type f "
            "\\( -name '*.html' -o -name '*.js' \\) | sort | while read f; do "
            "printf '%s  %s\\n' \"$(sha256sum \"$f\" | cut -d' ' -f1)\" \"$f\"; done"
        )
        cmd = "docker exec %s sh -c %s" % (config.container_name(), shlex.quote(inner))
        _stdin, stdout, _stderr = ssh.exec_command(cmd, timeout=120)
        out = stdout.read().decode("utf-8", errors="replace")
    finally:
        ssh.close()
    digest = hashlib.sha256()
    lines = [ln for ln in out.splitlines() if "  " in ln]
    for line in sorted(lines, key=lambda x: x.split("  ", 1)[-1]):
        file_hash, _, rel = line.partition("  ")
        digest.update(rel.encode("utf-8"))
        digest.update(bytes.fromhex(file_hash))
    return digest.hexdigest(), len(lines)


def create_tarball():
    temp_tar = os.path.join(tempfile.gettempdir(), "ahududu_build.tar.gz")
    if os.path.exists(temp_tar):
        os.remove(temp_tar)

    print(f"Build tarball hazırlanıyor: {temp_tar}")
    with tarfile.open(temp_tar, "w:gz") as tar:
        tar.add(os.path.join(ROOT_DIR, "Dockerfile"), arcname="Dockerfile")
        tar.add(os.path.join(ROOT_DIR, "docker-compose.yml"), arcname="docker-compose.yml")
        tar.add(os.path.join(ROOT_DIR, "backend"), arcname="backend")
        tar.add(os.path.join(ROOT_DIR, "logo"), arcname="logo")

    print(f"Tarball hazır ({os.path.getsize(temp_tar) / 1024:.1f} KB).")
    return temp_tar


def run_ssh_command(ssh, cmd, sudo=False, timeout=1800, check=False):
    if sudo:
        if PI_PASS:
            cmd = f"echo '{PI_PASS}' | sudo -S {cmd}"
        else:
            # Anahtar ile bağlanıldı: parolasız sudo (NOPASSWD) beklenir
            cmd = f"sudo -n {cmd}"
    print(f"\n>>> {cmd}")
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)

    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    status = stdout.channel.recv_exit_status()

    if out:
        print(out.strip())
    if err and "Password:" not in err:
        print(f"[ERR] {err.strip()}")

    if check and status != 0:
        raise RuntimeError(f"Komut başarısız oldu (exit={status}): {cmd}")
    return out


def deploy_to_pi():
    step(f"Raspberry Pi 5'e bağlanılıyor ({PI_HOST})")
    global PI_PASS
    # Önce SSH anahtarı, yoksa parola (AHUDUDU_PI_PASS). Parola koda yazılmaz.
    try:
        ssh, used_password = config.connect_ssh()
    except ConnectionError as exc:
        print(f"\n[deploy] {exc}\n", file=sys.stderr)
        raise SystemExit(2)
    PI_PASS = config.pi_password(required=False) if used_password else ""
    print("SSH bağlantısı kuruldu (%s)." % ("parola" if used_password else "SSH anahtarı"))

    try:
        run_ssh_command(ssh, "mkdir -p /DATA/AppData/ahududu/uploads /DATA/AppData/ahududu/src", sudo=True)
        run_ssh_command(ssh, "mkdir -p /var/lib/casaos/apps/ahududu", sudo=True)
        run_ssh_command(ssh, "chown -R murat:murat /DATA/AppData/ahududu /var/lib/casaos/apps/ahududu", sudo=True)

        tar_path = create_tarball()
        print("Tarball SFTP ile yükleniyor...")
        sftp = ssh.open_sftp()
        sftp.put(tar_path, "/DATA/AppData/ahududu/build.tar.gz")
        sftp.close()
        print("Yükleme tamamlandı.")

        step("Kaynak dosyalar açılıyor")
        run_ssh_command(ssh, "rm -rf /DATA/AppData/ahududu/src && "
                             "mkdir -p /DATA/AppData/ahududu/src && "
                             "tar -xzf /DATA/AppData/ahududu/build.tar.gz -C /DATA/AppData/ahududu/src")

        step("Docker imajı Pi 5 üzerinde derleniyor (native ARM64)")
        run_ssh_command(
            ssh,
            "docker build -t ghcr.io/muratcihanyandi/ahududu:latest /DATA/AppData/ahududu/src",
            timeout=3600,
            check=True,
        )

        step("CasaOS compose dosyası güncelleniyor")
        run_ssh_command(
            ssh,
            "cp /DATA/AppData/ahududu/src/docker-compose.yml /var/lib/casaos/apps/ahududu/docker-compose.yml",
            sudo=True,
            check=True,
        )

        step("Container yenileniyor")
        run_ssh_command(ssh, "docker compose -f /var/lib/casaos/apps/ahududu/docker-compose.yml down")
        run_ssh_command(
            ssh,
            "docker compose -f /var/lib/casaos/apps/ahududu/docker-compose.yml up -d",
            check=True,
        )
    finally:
        ssh.close()


def wait_for_health(expected_build_id):
    step("Canlı sürüm doğrulanıyor")
    url = f"http://{PI_HOST}:{PORT}/api/system/version"
    last_error = None

    for attempt in range(1, HEALTH_ATTEMPTS + 1):
        try:
            with urllib.request.urlopen(url, timeout=5) as response:
                payload = response.read().decode("utf-8")
            import json
            data = json.loads(payload)
            build_id = str(data.get("build_id", ""))
            if build_id == expected_build_id:
                print(f"Build ID eşleşti: {build_id}")
                print(f"Aktif özellikler: {', '.join(data.get('features', []))}")
                return True
            print(f"[{attempt}/{HEALTH_ATTEMPTS}] Sunucu build_id={build_id}, beklenen={expected_build_id}")
            last_error = f"build_id uyuşmuyor ({build_id} != {expected_build_id})"
        except (urllib.error.URLError, TimeoutError, ValueError) as e:
            print(f"[{attempt}/{HEALTH_ATTEMPTS}] Sunucu henüz hazır değil: {e}")
            last_error = str(e)
        time.sleep(HEALTH_DELAY_SECONDS)

    print(f"DOĞRULAMA BAŞARISIZ: {last_error}")
    return False


def verify_game_bundle(local_digest):
    """Canlı container'daki oyun paketleri yerelle birebir aynı mı?"""
    step("Oyun paketi canlı sunucuyla karşılaştırılıyor")
    remote_digest, file_count = remote_game_bundle_digest()
    if remote_digest == local_digest:
        print(f"Oyun paketi aynı ({file_count} dosya, sha256={remote_digest[:16]}…)")
        return True
    print(f"UYUŞMUYOR: yerel={local_digest[:16]}… canlı={remote_digest[:16]}… ({file_count} dosya)")
    return False


def update_static_only():
    """Sadece arayüz + oyun dosyalarını canlı container'a yaz (imaj yeniden derlenmez).

    Docker imajı build_id'ye bakmıyor: build-id.txt dosyasını her dağıtımda
    değiştirdiğimiz için her halükârda katman baştan kuruluyor (pip adımı dahil).
    Bu yol aynı dosyaları çalışan container'a kopyalar; sunucu build-id.txt'yi
    3 saniyede bir okuduğu için açık uygulamalar `app_update` alıp kendini
    yeniler. Yeni backend kodu gerektirmeyen (yalnızca arayüz/oyun) dağıtımlarda
    tam imaj derlemesinden çok daha hızlıdır.
    """
    step(f"Yalnızca statik dosyalar güncelleniyor ({PI_HOST})")
    try:
        ssh, _ = config.connect_ssh()
    except ConnectionError as exc:
        print(f"\n[deploy] {exc}\n", file=sys.stderr)
        raise SystemExit(2)

    try:
        tar_path = create_tarball()
        print("Tarball SFTP ile yükleniyor...")
        sftp = ssh.open_sftp()
        sftp.put(tar_path, "/DATA/AppData/ahududu/build.tar.gz")
        sftp.close()

        run_ssh_command(
            ssh,
            "rm -rf /DATA/AppData/ahududu/src && mkdir -p /DATA/AppData/ahududu/src && "
            "tar -xzf /DATA/AppData/ahududu/build.tar.gz -C /DATA/AppData/ahududu/src",
            check=True,
        )
        container = config.container_name()
        run_ssh_command(
            ssh,
            f"docker exec {container} rm -rf /app/backend/static/games && "
            f"docker cp /DATA/AppData/ahududu/src/backend/static/. {container}:/app/backend/static/",
            check=True,
        )
        run_ssh_command(ssh, f"docker exec {container} cat /app/backend/static/build-id.txt", check=True)
    finally:
        ssh.close()


def main():
    parser = argparse.ArgumentParser(description="Ahududu build + deploy + doğrulama")
    parser.add_argument("--skip-build", action="store_true", help="Frontend derlemesini atla")
    parser.add_argument("--skip-deploy", action="store_true", help="Sadece derle ve static'i senkronize et")
    parser.add_argument("--verify-only", action="store_true", help="Sadece canlı sürümü doğrula")
    parser.add_argument("--update-only", action="store_true",
                        help="İmaj derlemeden yalnızca statik dosyaları canlı container'a yaz (hızlı)")
    args = parser.parse_args()

    expected_build_id = local_build_id() if os.path.exists(os.path.join(STATIC_DIR, "index.html")) else ""
    local_games = game_bundle_digest()

    if args.verify_only:
        if not expected_build_id:
            raise RuntimeError("Yerel build bulunamadı, doğrulama yapılamaz.")
        ok = wait_for_health(expected_build_id) and verify_game_bundle(local_games)
        sys.exit(0 if ok else 1)

    if args.update_only:
        # Yalnızca kaynak dosyalar tazelenir (önbellek: yalnızca derlenmiş
        # paket backend/static'te durur; önceki tam dağıtımdan kalır).
        ensure_game_bundles()
    elif not args.skip_build:
        build_frontend()
        sync_static()
        expected_build_id = local_build_id()
        local_games = game_bundle_digest()
    elif not expected_build_id:
        raise RuntimeError("backend/static/index.html bulunamadı.")

    if args.skip_deploy:
        print(f"\nSadece derleme tamamlandı (build_id={expected_build_id}).")
        return

    if args.update_only:
        update_static_only()
    else:
        deploy_to_pi()

    if wait_for_health(expected_build_id) and verify_game_bundle(local_games):
        print("\nDAĞITIM TAMAMLANDI. Telefon uygulaması yeni sürümü otomatik alacak.")
    else:
        sys.exit(1)


if __name__ == "__main__":
    main()
