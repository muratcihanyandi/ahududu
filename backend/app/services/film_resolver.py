"""Film sitesi çözümleyici.

Kullanıcı "herhangi bir siteden herhangi bir video" istedi. Bazı siteler
(fullhdfilmizlesene gibi) video sayfasını doğrudan iframe'e gömmeye izin
vermez (X-Frame-Options / CSP). Bu modül sayfayı sunucu tarafında indirir ve
içindeki GERÇEK video kaynağını çıkarır:

  1. Sayfada gömülü <iframe> / <embed> adresleri
  2. JSON içindeki video/mp4/m3u8 adresleri
  3. data-src / src / file / videoUrl gibi alanlar
  4. Sayfanın kendi oynatıcı adresleri (embed/player/iframe yolları)

Bulunan adreslerden en uygunu seçilir ve sayfa içinde oynatılabilir hale
getirilir. Başarısız olursa sayfanın kendisi "yeni sekmede aç" seçeneğiyle
sunulur.
"""

import re
from typing import List, Optional
from urllib.parse import urlparse, urljoin

try:  # httpx opsiyonel olsun: yoksa sadece sözdizimi çözümlemesi yapılır
    import httpx
except ImportError:  # pragma: no cover
    httpx = None

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
REQUEST_TIMEOUT = 5.0
MAX_HTML_BYTES = 3_000_000

# Film siteleri bot koruması (Cloudflare vb.) kullanır. Gerçek bir tarayıcı
# isteğine benzeyen tam başlık seti gönderiyoruz.
BROWSER_HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": (
        "text/html,application/xhtml+xml,application/xml;q=0.9,"
        "image/avif,image/webp,image/apng,*/*;q=0.8"
    ),
    "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
    "Accept-Encoding": "gzip, deflate, br",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Sec-CH-UA": '"Chromium";v="131", "Not_A Brand";v="24"',
    "Sec-CH-UA-Mobile": "?0",
    "Sec-CH-UA-Platform": '"Windows"',
    "Cache-Control": "max-age=0",
    "Connection": "keep-alive",
}

VIDEO_FILE_RE = re.compile(
    r"https?://[^\s\"'<>\\]+?\.(?:mp4|webm|m3u8|mov|m4v)(?:\?[^\s\"'<>\\]*)?(?![\w])",
    re.I,
)
# Göreli video yolları: "/video/film.mp4", "video/film.m3u8"
RELATIVE_FILE_RE = re.compile(
    r"[\"'](/[^\"'<>\s]+?\.(?:mp4|webm|m3u8|mov|m4v)(?:\?[^\"'<>\s]*)?)[\"']",
    re.I,
)
# Manifest / simge / site dosyaları video SANILMAMALI.
# Gerçek olay: "site.webmanifest" içindeki "site.webm" dizgesi video sanılıp
# perde boş kalıyordu (film sayfası yerine site.webm açılıyordu).
NOT_VIDEO_RE = re.compile(
    r"(?:manifest|favicon|\.svg|\.png|\.jpe?g|\.webp|\.gif|\.css|\.js|\.json|\.ico|\.woff2?)(?:\?|$)",
    re.I,
)
IFRAME_RE = re.compile(r"<iframe[^>]+src=[\"']([^\"']+)[\"']", re.I)
EMBED_RE = re.compile(r"<embed[^>]+src=[\"']([^\"']+)[\"']", re.I)
# Film siteleri gerçek oynatıcıyı iframe'in data-src'sinde tutar (JS ile yüklenir)
IFRAME_DATA_SRC_RE = re.compile(r"<iframe[^>]+(?:data-src|data-lazy-src)=[\"']([^\"']+)[\"']", re.I)
DATA_SRC_RE = re.compile(r"(?:data-src|data-video|data-file|videoUrl|video_url|\"file\"|\"source\"|\"src\"|\"url\")\s*[:=]\s*[\"']([^\"']+)[\"']", re.I)
JSON_URL_RE = re.compile(r"https?://[^\s\"'<>{}]+?/(?:embed|player|iframe|video|movie|watch|vod)[^\s\"'<>{}]*", re.I)
# Sayfadaki her türlü youtube/vimeo embed adresi (\\/ kaçışlı JSON dahil)
YOUTUBE_EMBED_RE = re.compile(
    r"(?:youtube\.com/embed/|youtube-nocookie\.com/embed/|youtu\.be/)([A-Za-z0-9_-]{6,})", re.I
)
VIMEO_EMBED_RE = re.compile(r"player\.vimeo\.com/video/(\d+)", re.I)

# Bu adresler oynatılabilir kaynak sayılır (iframe içinde açılabilir)
PLAYER_HOSTS = (
    "youtube.com", "youtu.be", "vimeo.com", "dailymotion.com", "bilibili.com",
    "ok.ru", "streamable.com", "twitch.tv", "facebook.com", "instagram.com",
    "vidsrc", "embed.su", "2embed", "multiembed", "player", "rabbitstream",
    "cdn", "proton", "themoviedb", "filemoon", "vidcloud", "dood",
    "rapidvid", "vidmoly", "streamtape", "mixdrop", "upstream", "doodstream",
    "voe.sx", "voe.", "luluvdo", "okstream", "sibnet", "wmobile", "uqload",
    "/vod/", "/embed/", "/player/", "/e/",
)


def _absolute(base: str, url: str) -> str:
    if not url:
        return ""
    url = url.strip()
    if url.startswith("//"):
        return "https:" + url
    if url.startswith("http"):
        return url
    return urljoin(base, url)


def _is_player(url: str) -> bool:
    low = url.lower()
    return any(host in low for host in PLAYER_HOSTS) or low.endswith((".mp4", ".m3u8", ".webm"))


def extract_candidates(html: str, page_url: str) -> List[dict]:
    """Sayfadan oynatılabilir adayları çıkarır (sıralı, en iyisi önce)."""
    found: List[dict] = []
    seen = set()

    def add(url: str, kind: str, score: int):
        absolute = _absolute(page_url, url)
        if not absolute or absolute in seen:
            return
        if absolute.rstrip("/") == page_url.rstrip("/"):
            return
        # Manifest/simge/CSS gibi dosyalar video değildir. Dikkat: sayfada
        # "site.webmanifest" yazarken VIDEO_FILE_RE ondan "site.webm" kesiyor
        # (uzantı eşleşmesi). Bu yüzden eşleşmenin DEVAMI da denetlenir.
        if kind == "file" and NOT_VIDEO_RE.search(absolute.split("?")[0]):
            return
        seen.add(absolute)
        found.append({"url": absolute, "kind": kind, "score": score})

    # Film sitelerindeki YouTube/Vimeo bağlantıları FRAGMANDIR (trailer).
    # Kullanıcı filmin kendisini izlemek istediği için sayfadaki YouTube fragmanları
    # asla tam film videosu olarak seçilmez. Yalnızca doğrudan video dosyaları (.mp4, .m3u8)
    # veya gerçek video stream oynatıcıları taranır.

    # 1) Doğrudan video dosyaları (en iyi)
    for match in VIDEO_FILE_RE.findall(html):
        add(match, "file", 100)

    # 1b) Göreli video yolları (/video/film.mp4)
    for match in RELATIVE_FILE_RE.findall(html):
        add(match, "file", 98)

    # 2) data-* / JSON alanlarından video dosyaları
    for match in DATA_SRC_RE.findall(html):
        if match.lower().split("?")[0].endswith((".mp4", ".m3u8", ".webm", ".mov", ".m4v")):
            add(match, "file", 95)

    # 3) iframe / embed adresleri (data-src dahil: film siteleri oynatıcıyı
    #    iframe'in data-src'sinde tutar ve JS ile yükler)
    for match in (
        IFRAME_DATA_SRC_RE.findall(html)
        + IFRAME_RE.findall(html)
        + EMBED_RE.findall(html)
    ):
        if _is_player(match):
            add(match, "embed", 85)

    # 4) JSON içindeki oynatıcı adresleri
    for match in JSON_URL_RE.findall(html):
        if _is_player(match):
            add(match, "embed", 60)

    return sorted(found, key=lambda item: -item["score"])


async def _fetch_with_curl(page_url: str) -> tuple[int, str]:
    """httpx engellendiğinde sistemdeki curl ile indirmeyi dene.

    Bazı siteler (Cloudflare) TLS parmak izine göre bot ayırt eder; curl
    genellikle gerçek tarayıcıya daha yakın görünür.
    """
    import asyncio
    import shutil

    curl = shutil.which("curl")
    if not curl:
        return 0, ""

    args = [
        curl, "-sL", "--compressed", "--max-time", "6",
        "-A", USER_AGENT,
        "-H", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "-H", "Accept-Language: tr-TR,tr;q=0.9,en;q=0.8",
        "-H", "Sec-Fetch-Dest: document",
        "-H", "Sec-Fetch-Mode: navigate",
        "-H", "Sec-Fetch-Site: none",
        "-w", "\\n__HTTP_%{http_code}__",
        page_url,
    ]
    try:
        process = await asyncio.create_subprocess_exec(
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        stdout, _ = await asyncio.wait_for(process.communicate(), timeout=8)
        text = stdout.decode("utf-8", errors="replace")
        match = re.search(r"__HTTP_(\d{3})__\s*$", text)
        status = int(match.group(1)) if match else 0
        body = text[: match.start()] if match else text
        return status, body
    except Exception:  # noqa: BLE001
        return 0, ""


async def resolve_page_video(page_url: str) -> dict:
    """Film sayfasını indirir ve oynatılabilir video kaynağını bulur."""
    parsed = urlparse(page_url)
    if not parsed.netloc:
        return {"ok": False, "reason": "Geçersiz adres"}

    if httpx is None:
        return {"ok": False, "reason": "Sayfa çözümleyici yüklü değil"}

    try:
        async with httpx.AsyncClient(
            follow_redirects=True,
            timeout=REQUEST_TIMEOUT,
            headers=BROWSER_HEADERS,
            http2=False,
        ) as client:
            # Önce doğrudan dene
            response = await client.get(page_url)

            # Bot koruması çerez isteyebilir: ana sayfayı ziyaret edip
            # elde edilen çerezlerle tekrar dene.
            if response.status_code in (403, 429, 503):
                parsed_root = f"{parsed.scheme}://{parsed.netloc}/"
                try:
                    await client.get(parsed_root)
                    response = await client.get(page_url, headers={"Referer": parsed_root})
                except Exception:  # noqa: BLE001
                    pass
    except Exception as exc:  # noqa: BLE001 - her türlü ağ hatası tek noktada
        return {"ok": False, "reason": f"Sayfaya ulaşılamadı: {type(exc).__name__}"}

    if response.status_code >= 400:
        # httpx engellendi: curl ile tekrar dene (TLS parmak izi farkı)
        curl_status, curl_html = await _fetch_with_curl(page_url)
        if curl_status == 200 and curl_html:
            candidates = extract_candidates(curl_html, page_url)
            if candidates:
                best = candidates[0]
                return {
                    "ok": True,
                    "url": best["url"],
                    "kind": best["kind"],
                    "candidates": [c["url"] for c in candidates[:5]],
                    "page_title": _page_title(curl_html),
                }
        return {
            "ok": False,
            "reason": f"Site {response.status_code} döndü (bot koruması olabilir)",
            "blocked": response.status_code in (403, 429, 503),
        }

    html = response.text[:MAX_HTML_BYTES]
    candidates = extract_candidates(html, str(response.url) or page_url)

    if candidates:
        best = candidates[0]
        return {
            "ok": True,
            "url": best["url"],
            "kind": best["kind"],
            "candidates": [c["url"] for c in candidates[:5]],
            "page_title": _page_title(html),
        }

    # httpx sayfayı aldı ama video bulunamadı: site bot koruması yüzünden
    # eksik içerik döndürmüş olabilir. curl ile tekrar dene (TLS parmak izi farkı).
    curl_status, curl_html = await _fetch_with_curl(page_url)
    if curl_status == 200 and curl_html:
        curl_candidates = extract_candidates(curl_html, page_url)
        if curl_candidates:
            best = curl_candidates[0]
            return {
                "ok": True,
                "url": best["url"],
                "kind": best["kind"],
                "candidates": [c["url"] for c in curl_candidates[:5]],
                "page_title": _page_title(curl_html),
            }

    return {
        "ok": False,
        "reason": "Sayfada oynatılabilir video bulunamadı",
        "page_title": _page_title(html),
    }


def _page_title(html: str) -> Optional[str]:
    match = re.search(r"<title[^>]*>(.*?)</title>", html, re.I | re.S)
    if not match:
        return None
    title = re.sub(r"\s+", " ", match.group(1)).strip()
    # "Arabalar Full HD İzle - site.com" -> "Arabalar Full HD İzle"
    return title[:200] or None
