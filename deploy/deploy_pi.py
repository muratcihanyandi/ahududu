import os
import sys
import tarfile
import tempfile
import paramiko
import time

# Ensure safe printing on Windows terminals
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

PI_HOST = "192.168.2.170"
PI_USER = "murat"
PI_PASS = "3366"
PORT = 33470

def create_tarball():
    temp_tar = os.path.join(tempfile.gettempdir(), "ahududu_build.tar.gz")
    if os.path.exists(temp_tar):
        os.remove(temp_tar)
        
    print(f"Creating build tarball at {temp_tar}...")
    root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    
    with tarfile.open(temp_tar, "w:gz") as tar:
        tar.add(os.path.join(root_dir, "Dockerfile"), arcname="Dockerfile")
        tar.add(os.path.join(root_dir, "docker-compose.yml"), arcname="docker-compose.yml")
        tar.add(os.path.join(root_dir, "backend"), arcname="backend")
        tar.add(os.path.join(root_dir, "logo"), arcname="logo")
        
    print(f"Tarball created successfully ({os.path.getsize(temp_tar) / 1024:.1f} KB).")
    return temp_tar

def run_ssh_command(ssh, cmd, sudo=False):
    if sudo:
        cmd = f"echo '{PI_PASS}' | sudo -S {cmd}"
    print(f"\n>>> Executing: {cmd}")
    stdin, stdout, stderr = ssh.exec_command(cmd)
    
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    
    if out:
        try:
            print(out.strip())
        except Exception:
            print(out.encode('ascii', errors='replace').decode())
    if err and "Password:" not in err:
        try:
            print(f"[ERR] {err.strip()}")
        except Exception:
            pass
    return out

def deploy():
    print(f"Connecting to Raspberry Pi 5 at {PI_HOST}...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(PI_HOST, username=PI_USER, password=PI_PASS, timeout=15)
    print("SSH Connected successfully!")
    
    # 1. Create remote directories
    run_ssh_command(ssh, "mkdir -p /DATA/AppData/ahududu/uploads /DATA/AppData/ahududu/src", sudo=True)
    run_ssh_command(ssh, "mkdir -p /var/lib/casaos/apps/ahududu", sudo=True)
    run_ssh_command(ssh, "chown -R murat:murat /DATA/AppData/ahududu /var/lib/casaos/apps/ahududu", sudo=True)
    
    # 2. Upload tarball
    tar_path = create_tarball()
    print("Uploading tarball via SFTP...")
    sftp = ssh.open_sftp()
    remote_tar = "/DATA/AppData/ahududu/build.tar.gz"
    sftp.put(tar_path, remote_tar)
    sftp.close()
    print("Upload complete!")
    
    # 3. Extract source on Pi
    print("Extracting source files...")
    run_ssh_command(ssh, "tar -xzf /DATA/AppData/ahududu/build.tar.gz -C /DATA/AppData/ahududu/src")
    
    # 4. Build Docker container locally on Pi 5 (ARM64 native)
    print("Building Docker image on Raspberry Pi 5 (native ARM64)...")
    build_cmd = "docker build -t ghcr.io/muratcihanyandi/ahududu:latest /DATA/AppData/ahududu/src"
    run_ssh_command(ssh, build_cmd, sudo=False)
    
    # 5. Place CasaOS docker-compose.yml
    print("Configuring CasaOS compose...")
    run_ssh_command(ssh, "cp /DATA/AppData/ahududu/src/docker-compose.yml /var/lib/casaos/apps/ahududu/docker-compose.yml", sudo=True)
    
    # 6. Stop existing container if running & start new one
    print("Starting Ahududu container...")
    run_ssh_command(ssh, "docker compose -f /var/lib/casaos/apps/ahududu/docker-compose.yml down", sudo=False)
    run_ssh_command(ssh, "docker compose -f /var/lib/casaos/apps/ahududu/docker-compose.yml up -d", sudo=False)
    
    # 7. Health check
    time.sleep(4)
    print("\n--- Running health check ---")
    health = run_ssh_command(ssh, f"curl -s http://localhost:{PORT}/api/system/version")
    print(f"Health check response: {health}")
    
    ps = run_ssh_command(ssh, "docker ps --filter name=ahududu")
    print("\nAhududu successfully running on Raspberry Pi 5 under CasaOS!")
    ssh.close()

if __name__ == "__main__":
    deploy()
