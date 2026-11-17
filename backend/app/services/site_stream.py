"""Film sitesi akış çözücü — üçüncü parti sitelerdeki GERÇEK video akışını bulur.

Sorun nedir?
------------
fullhdfilmizlesene gibi sitelerde "Oynat" düğmesine basınca perde **kara
ekranda** kalıyordu. Sebebi zincirin ilk halkasıydı: sayfada <iframe> YOK.
Oynatıcı, JS ile küçük bir oynatıcı adresinden kurulur ve o adres de şifreli
halde saklanır:

    film sayfası
      └── var scx = {...}            <- oynatıcı adresleri, ROT13 + base64
            └── https://rapidvid.org/vod/v1...
                  └── jwSetup.sources = [{file: av('...')}]   <- HLS, özel kodlama
                        └── master manifest (.m3u8)
                              └── segmentler (bazen .jpg kılığında MPEG-TS)

`film_resolver` bu zinciri yürüyemez: yalnızca HTML içindeki hazır adresleri
arar. Bu modül zinciri yürür ve perdeye konabilecek bir akış döner.

Neden sunucudan servis ediyoruz?
--------------------------------
Bu akışlar:
  1. Yalnızca **iframe içinde** açılınca içerik verir (Sec-Fetch-Dest),
  2. Tarayıcıya **CORS başlığı vermez** — hls.js doğrudan okuyamaz,
  3. `Referer` istemez ama bazı CDN'ler ister.
Bu yüzden master, alt playlist ve segmentler `/api/cinema/hls` üzerinden
proxy'lenir: adresler sunucudan geçerken gereken başlıklar eklenir.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import re
import shutil
import time
from dataclasses import dataclass, field
from typing import Optional
from urllib.parse import urljoin, urlparse

logger = logging.getLogger("ahududu.site_stream")

try:
    import httpx
except ImportError:  # pragma: no cover
    httpx = None

USER_AGENT = (
    "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36"
)

# Embed'ler iframe içinde açılmayı bekler. Bu başlıklar olmadan 404 dönerler
# (doğrulandı: rapidvid.org document isteğine 404, iframe isteğine 200 veriyor).
IFRAME_HEADERS = {
    "Sec-Fetch-Dest": "iframe",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "cross-site",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
}
DOCUMENT_HEADERS = {
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Upgrade-Insecure-Requests": "1",
}

# ---------------------------------------------------------------------------
# Kalıplar
# ---------------------------------------------------------------------------
# Akış adresi: .m3u8, master.txt, /hls/ ... (imza parametreleriyle birlikte)
STREAM_URL_RE = re.compile(
    r"https?://[^\s\"'<>\\]+?(?:\.m3u8|/master\.txt|master\.txt)(?:\?[^\s\"'<>\\]*)?",
    re.I,
)
# Oynatıcı yapılandırması: sources = [{file: "..."}], contentUrl, ...
# DİKKAT: "url" BİLİNÇLİ OLARAK YOK. Sayfadaki JSON-LD (schema.org Movie)
# alanları da `"url"` taşıyor ve oyuncu/film sayfaları akış sanılıyordu.
PLAYER_FILE_RE = re.compile(
    r"[\"'](?:file|hls|src|source|contentUrl|streamUrl|videoUrl)[\"']\s*:\s*[\"']([^\"']{8,})[\"']",
    re.I,
)
# av('...') / t('...') gibi özel kodlayıcı çağrıları
ENCODED_CALL_RE = re.compile(r"\b(?:av|_|d|dec|unpack)\s*\(\s*['\"]([A-Za-z0-9+/=_\-]{24,})['\"]\s*\)")
IFRAME_SRC_RE = re.compile(r"<iframe[^>]+(?:data-src|src)=[\"']([^\"']+)[\"']", re.I)
SCX_JSON_RE = re.compile(r"var\s+scx\s*=\s*(\{.*?\})\s*;", re.S)

STREAM_HINTS = (".m3u8", "master.txt", "/hls/", "/m3u8/", "/vod/", "/m6/", "/m8/")

# Önbellek: imzalı adresler kısa ömürlü olabilir.
STREAM_TTL_SECONDS = 900
MAX_DEPTH = 2


@dataclass
class StreamSource:
    """Perdeye konabilecek, sunucunun servis edebileceği akış."""

    ok: bool
    #: Master adresi (m3u8 / master.txt). Sunucu üzerinden proxy'lenir.
    url: str = ""
    #: Akışa erişirken gereken Referer (embed sayfasının adresi).
    referer: str = ""
    title: Optional[str] = None
    #: Teşhis: izlenen adımlar
    trail: list = field(default_factory=list)
    reason: str = ""
    #: Kaynak tipi: "hls" | "file"
    kind: str = "hls"


# site -> (zaman, StreamSource)
_CACHE: dict[str, tuple[float, StreamSource]] = {}


def _cache_get(key: str) -> Optional[StreamSource]:
    entry = _CACHE.get(key)
    if not entry:
        return None
    stamp, value = entry
    if time.time() - stamp > STREAM_TTL_SECONDS:
        _CACHE.pop(key, None)
        return None
    return value


def _cache_put(key: str, value: StreamSource) -> None:
    if len(_CACHE) > 300:
        _CACHE.clear()
    _CACHE[key] = (time.time(), value)


def _headers_for(url: str, referer: str = "", accept: str = "") -> dict:
    """Adrese göre gerçekçi tarayıcı başlıkları üret."""
    parsed = urlparse(url)
    if referer:
        site = "same-origin" if urlparse(referer).netloc == parsed.netloc else "cross-site"
        headers = dict(IFRAME_HEADERS)
        headers["Sec-Fetch-Site"] = site
        headers["Referer"] = referer
    else:
        headers = dict(DOCUMENT_HEADERS)
    headers["User-Agent"] = USER_AGENT
    headers["Accept-Language"] = "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7"
    headers["Accept"] = accept or (
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    )
    return headers


# ---------------------------------------------------------------------------
# 1) Sayfa indirme: httpx + curl yedeği
# ---------------------------------------------------------------------------
#
# Cloudflare, TLS parmak izine göre bot ayırt ediyor: aynı başlıklarla httpx
# 403 alırken curl 200 alıyor (ölçüldü). Bu yüzden httpx reddederse curl ile
# aynı başlıklar kullanılarak tekrar denenir. Aksi halde salon film sitelerini
# hiç açamazdı.


async def _fetch_with_curl(url: str, headers: dict, timeout: float = 20.0) -> tuple[int, str]:
    """curl ile indir. (durum, gövde) döner; başarısızsa (0, "")."""
    curl = shutil.which("curl") or shutil.which("curl.exe")
    if not curl:
        return 0, ""

    args = [curl, "-sL", "--compressed", "--max-time", str(int(timeout))]
    for key, value in headers.items():
        args += ["-H", f"{key}: {value}"]
    args += ["-w", "\n__HTTP_%{http_code}__", url]

    try:
        process = await asyncio.create_subprocess_exec(
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        stdout, _ = await asyncio.wait_for(process.communicate(), timeout=timeout + 5)
    except Exception:  # noqa: BLE001
        return 0, ""

    text = stdout.decode("utf-8", "replace")
    match = re.search(r"__HTTP_(\d{3})__\s*$", text)
    status = int(match.group(1)) if match else 0
    body = text[: match.start()] if match else text
    return status, body


class _Response:
    """httpx.Response ile curl sonucunu aynı arayüzde taşır."""

    def __init__(self, status_code: int, text: str, url: str):
        self.status_code = status_code
        self.text = text
        self.url = url


async def fetch_page(url: str, headers: dict, client: Optional["httpx.AsyncClient"] = None) -> _Response:
    """Sayfayı indir: önce httpx, reddedilirse curl ile tekrar dene."""
    if client is not None and httpx is not None:
        try:
            response = await client.get(url, headers=headers)
            if response.status_code < 400:
                return _Response(response.status_code, response.text, str(response.url) or url)
            status, body = await _fetch_with_curl(url, headers)
            if status and status < 400 and body:
                logger.debug("curl yedeği kullanıldı (%s -> %s): %s", response.status_code, status, url)
                return _Response(status, body, url)
            return _Response(response.status_code, response.text, str(response.url) or url)
        except Exception:  # noqa: BLE001 - ağ hatasında curl'e düş
            pass

    status, body = await _fetch_with_curl(url, headers)
    return _Response(status, body, url)


# ---------------------------------------------------------------------------
# 2) Site şifreleme çözücüleri
# ---------------------------------------------------------------------------

def _rot13(text: str) -> str:
    """Harfleri 13 kaydır (site bunu `rtt()` adıyla kullanıyor)."""
    out = []
    for ch in text:
        if ch.isalpha():
            shift = 13 if ch.lower() < "n" else -13
            out.append(chr(ord(ch) + shift))
        else:
            out.append(ch)
    return "".join(out)


def _b64(text: str) -> str:
    """Toleranslı base64 çözümü: dolgu/eksik karakter sorun çıkarmasın."""
    clean = text.strip().replace("-", "+").replace("_", "/")
    clean += "=" * ((4 - len(clean) % 4) % 4)
    try:
        return base64.b64decode(clean).decode("utf-8", "replace")
    except Exception:  # noqa: BLE001
        return ""


def decode_site_payload(value: str) -> Optional[str]:
    """`scx` içindeki oynatıcı adresini çöz.

    Site bunu iki katmanda saklıyor: önce ROT13, sonra base64. Sıra önemli —
    önce reversed+rot13, sonra base64 (JS: ``atob(rtt(t))``).
    """
    if not value:
        return None
    for attempt in (value, _rot13(value), _rot13(value[::-1]), value[::-1]):
        decoded = _b64(attempt)
        if decoded.startswith(("http://", "https://", "/")):
            return decoded
    return None


def decode_obfuscated_stream(encoded: str) -> Optional[str]:
    """Oynatıcının `av()` kodlamasını çöz (ters çevir + kaydırmalı atob ×2).

    JS karşılığı::

        t = atob(e.reverse())
        for i: t[i] -= ("K9L"[i % 3].charCodeAt(0) % 5 + 1)
        url = atob(t)
    """
    if not encoded:
        return None
    try:
        key = "K9L"
        stage = _b64(encoded[::-1])
        out = "".join(
            chr((ord(ch) - (ord(key[i % 3]) % 5 + 1)) & 0xFF)
            for i, ch in enumerate(stage)
        )
        final = _b64(out)
        if final.startswith(("http://", "https://", "/")):
            return final
    except Exception:  # noqa: BLE001
        return None
    return None


def extract_scx_sources(html: str, page_url: str) -> list[str]:
    """Sayfadaki `scx` bloğundan oynatıcı (embed) adreslerini çıkar.

    Film siteleri gerçek oynatıcıyı burada tutar; HTML'de <iframe> yoktur.
    ``sx.t`` = tek parça (dublaj), ``sx.p`` = parçalı (altyazı) kaynaklar.
    """
    match = SCX_JSON_RE.search(html)
    if not match:
        return []
    try:
        scx = json.loads(match.group(1))
    except Exception:  # noqa: BLE001
        return []

    found: list[str] = []

    def add(raw: str) -> None:
        decoded = decode_site_payload(raw)
        if not decoded:
            return
        url = urljoin(page_url, decoded)
        if url.startswith("http") and url not in found:
            found.append(url)

    for entry in scx.values():
        if not isinstance(entry, dict):
            continue
        sx = entry.get("sx") or {}
        for key in ("t", "p"):
            values = sx.get(key) or []
            if isinstance(values, list):
                for raw in values:
                    if isinstance(raw, str):
                        add(raw)
    return found


# ---------------------------------------------------------------------------
# 2) Adres çıkarma
# ---------------------------------------------------------------------------

def _looks_like_stream(url: str) -> bool:
    low = (url or "").lower()
    return any(hint in low for hint in STREAM_HINTS)


# Görsel/stil/betik dosyaları video SANILMAMALI. Gerçek hata: filmin kapak
# görseli (`.../cover/izle/arabalar-fh1-968.jpg`) akış sanılıp perdeye kondu.
NOT_MEDIA_RE = re.compile(
    r"(?:\.png|\.jpe?g|\.webp|\.gif|\.svg|\.avif|\.ico|\.css|\.js|\.json|\.woff2?|\.vtt|\.srt)"
    r"(?:\?|$)",
    re.I,
)
# Altyazı sunucuları: oynatıcı yapılandırmasında görünür ama video DEĞİLDİR.
SUBTITLE_HOSTS = ("subs.", "subtitle", "altyazi", "captions")


def _is_media_file(url: str) -> bool:
    return not NOT_MEDIA_RE.search(url.split("?")[0])


def _extract_stream_urls(html: str, base_url: str) -> list[str]:
    """Bir HTML parçasındaki akış adaylarını döndür (sıralı)."""
    found: list[str] = []

    def add(raw: str, decoded: bool = False) -> None:
        if not raw:
            return
        url = urljoin(base_url, raw.strip())
        if not url.startswith("http") or url in found:
            return
        if not _is_media_file(url):
            return
        low = url.lower()
        if any(host in low for host in SUBTITLE_HOSTS):
            return
        # JS birleştirme artıkları ("...||", "...+", "...'") akış değildir.
        if re.search(r"[|+'\"]", url[8:]):
            return
        found.append(url)

    # 1) Hazır akış adresleri
    for match in STREAM_URL_RE.findall(html):
        add(match)

    # 2) Oynatıcı yapılandırması (sources = [{file: ...}])
    #    Yalnızca akış gibi görünenler: oynatıcı sayfaları ayrıca hata/logo
    #    adresleri taşır (ör. /ifr/vod/error.php) ve bunlar video değildir.
    for match in PLAYER_FILE_RE.findall(html):
        if _looks_like_stream(match):
            add(match)

    # 3) Özel kodlanmış akış adresleri — ASIL YOL (av('...'))
    for match in ENCODED_CALL_RE.findall(html):
        decoded = decode_obfuscated_stream(match)
        if decoded:
            add(decoded)
    # 3b) Çok uzun base64 blokları da aynı kodlamayı kullanabilir
    if not found:
        for match in re.findall(r"['\"]([A-Za-z0-9+/=]{80,})['\"]", html):
            decoded = decode_obfuscated_stream(match)
            if decoded and _looks_like_stream(decoded):
                add(decoded)

    # 4) JSON içinde kaçışlı adresler (\/)
    for match in re.findall(r"https?:\\?/\\?/[^\s\"'<>]+", html):
        cleaned = match.replace("\\/", "/")
        if _looks_like_stream(cleaned):
            add(cleaned)

    return _rank_streams(found)


def _rank_streams(urls: list[str]) -> list[str]:
    """Gerçek akışları başa al; hata/logo adreslerini sona at.

    Oynatıcı sayfaları kendi hata şablonunu da taşır
    (``/ifr/vod/error.php?msg=``) — bu bir video değildir.
    """
    def score(url: str) -> int:
        low = url.lower()
        if ".php" in low or "error" in low:
            return 90
        if re.search(r"\.(?:m3u8|mpd)(?:\?|$)|master\.txt", low):
            return 0
        # Gerçek HLS CDN yolu: /m6/<token>, /m8/<token> gibi.
        if re.search(r"/m[0-9a-z]{1,3}/[A-Za-z0-9_\-]{16,}", url):
            return 1
        if "/hls/" in low:
            return 5
        if "/vod/" in low or "/m8/" in low:
            return 20
        if re.search(r"\.(?:mp4|webm|mov|m4v)(?:\?|$)", low):
            return 15
        return 40

    return sorted(urls, key=score)


def _iframe_candidates(html: str, page_url: str) -> list[str]:
    """Sayfadaki iframe adreslerini döndür (oynatıcı olabilecekler önce)."""
    urls: list[str] = []
    for raw in IFRAME_SRC_RE.findall(html):
        url = urljoin(page_url, raw.strip())
        if url.startswith("http") and url not in urls:
            urls.append(url)

    noise = ("google", "doubleclick", "googlesyndication", "analytics", "facebook",
             "disqus", "yandex", "adservice", "adsystem", "twitter")
    signal = ("video", "embed", "player", "iframe", "rapid", "watch", "izle", "play", "vod")

    def score(u: str) -> int:
        low = u.lower()
        if any(n in low for n in noise):
            return -100
        return sum(1 for s in signal if s in low)

    return sorted(urls, key=lambda u: -score(u))


def _is_hls(url: str) -> bool:
    """Adres bir HLS manifesti mi?

    Gerçek HLS CDN adresleri uzantısız olabiliyor (``/m8/<token>``); bu yüzden
    yalnızca uzantıya değil yolun biçimine de bakıyoruz.
    """
    low = url.lower()
    if ".m3u8" in low or "master.txt" in low or "/hls/" in low:
        return True
    if re.search(r"/m[0-9a-z]{1,3}/[A-Za-z0-9_\-]{16,}", url):
        return True
    return False


def _is_page_url(url: str, page_url: str) -> bool:
    return url.rstrip("/") == page_url.rstrip("/")


def _page_title(html: str) -> Optional[str]:
    match = re.search(r"<title[^>]*>(.*?)</title>", html, re.I | re.S)
    if not match:
        return None
    title = re.sub(r"\s+", " ", match.group(1)).strip()
    return title or None


# ---------------------------------------------------------------------------
# 3) Zinciri yürü
# ---------------------------------------------------------------------------

async def resolve_stream(page_url: str, client: "httpx.AsyncClient", depth: int = 0) -> StreamSource:
    """Film sayfasından (veya embed'den) gerçek akışı bul."""
    if depth > MAX_DEPTH:
        return StreamSource(ok=False, reason="Çok fazla iç içe oynatıcı")

    trail = [f"sayfa: {page_url}"]
    response = await fetch_page(page_url, _headers_for(page_url), client)

    trail.append(f"durum: {response.status_code}")
    if response.status_code >= 400:
        return StreamSource(ok=False, reason=f"Site {response.status_code} döndü", trail=trail)

    html = response.text
    base = str(response.url) or page_url
    title = _page_title(html)

    # 1) Sayfanın kendisinde hazır bir akış var mı?
    direct = [u for u in _extract_stream_urls(html, base) if not _is_page_url(u, base)]
    if direct:
        trail.append(f"doğrudan akış: {direct[0][:90]}")
        return StreamSource(
            ok=True, url=direct[0], referer=page_url, title=title,
            kind="hls" if _is_hls(direct[0]) else "file", trail=trail,
        )

    # 2) scx: sitenin şifreli oynatıcı adresleri (ASIL YOL)
    scx_sources = extract_scx_sources(html, base)
    trail.append(f"scx kaynak: {len(scx_sources)}")
    for embed_url in scx_sources[:3]:
        trail.append(f"  -> {embed_url[:90]}")
        embed = await _fetch_embed(embed_url, page_url, client)
        if embed.ok:
            embed.title = embed.title or title
            embed.trail = trail + embed.trail
            return embed
        trail.append(f"     embed: {embed.reason}")

    # 3) Klasik <iframe> yolu
    iframes = _iframe_candidates(html, base)
    trail.append(f"iframe: {len(iframes)}")
    for iframe in iframes[:3]:
        if any(n in iframe.lower() for n in ("google", "doubleclick", "adsystem")):
            continue
        trail.append(f"  -> {iframe[:90]}")
        embed = await _fetch_embed(iframe, page_url, client)
        if embed.ok:
            embed.title = embed.title or title
            embed.trail = trail + embed.trail
            return embed
        trail.append(f"     embed: {embed.reason}")

    return StreamSource(ok=False, reason="Oynatılabilir akış bulunamadı", title=title, trail=trail)


async def _fetch_embed(embed_url: str, page_url: str, client: "httpx.AsyncClient") -> StreamSource:
    """Embed oynatıcı sayfasını iframe başlıklarıyla aç ve akışı çıkar."""
    trail: list[str] = []
    response = await fetch_page(embed_url, _headers_for(embed_url, page_url), client)

    trail.append(f"embed {response.status_code}")
    # Embed'ler çoğu zaman referer'sız ister; iframe niyeti yine de gerekli.
    if response.status_code >= 400:
        response = await fetch_page(embed_url, _headers_for(embed_url), client)
        trail.append(f"embed(tekrar) {response.status_code}")
        if response.status_code >= 400:
            return StreamSource(ok=False, reason=f"embed {response.status_code}", trail=trail)

    html = response.text
    base = str(response.url) or embed_url
    title = _page_title(html)

    candidates = _extract_stream_urls(html, base)
    if not candidates:
        for inner in _iframe_candidates(html, base)[:2]:
            sub = await _fetch_embed(inner, embed_url, client)
            if sub.ok:
                sub.trail = trail + sub.trail
                return sub
        return StreamSource(ok=False, reason="embed içinde akış yok", trail=trail, title=title)

    chosen = candidates[0]
    trail.append(f"akış: {chosen[:90]}")
    return StreamSource(
        ok=True,
        url=chosen,
        referer=embed_url,
        title=title,
        kind="hls" if _is_hls(chosen) else "file",
        trail=trail,
    )


async def resolve_site_stream(page_url: str, use_cache: bool = True) -> StreamSource:
    """Dışa açılan kapı: film sitesi linkinden oynatılabilir akış çöz."""
    if httpx is None:
        return StreamSource(ok=False, reason="HTTP istemcisi yüklü değil")

    key = page_url.strip()
    if use_cache:
        cached = _cache_get(key)
        if cached:
            logger.debug("site akışı önbellekten: %s", key)
            return cached

    async with httpx.AsyncClient(
        follow_redirects=True,
        timeout=15.0,
        http2=False,
        headers={"User-Agent": USER_AGENT},
    ) as client:
        try:
            result = await asyncio.wait_for(resolve_stream(key, client), timeout=25.0)
        except asyncio.TimeoutError:
            result = StreamSource(ok=False, reason="Akış çözümü zaman aşımına düştü")

    if result.ok:
        _cache_put(key, result)
        logger.info("site akışı çözüldü: %s -> %s", key, result.url[:80])
    else:
        logger.info("site akışı çözülemedi: %s (%s)", key, result.reason)

    return result
