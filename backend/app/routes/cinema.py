"""Sinema Salonu — birlikte izleme odası.

Murat ya da Selin herhangi bir siteden bir video linki seçer. Link, sayfa
içinde oynatılabilir (iframe / doğrudan video dosyası) hale getirilir. İki
telefon da aynı filmi aynı saniyede görür: oynat / duraklat / sarma işlemleri
WebSocket üzerinden anında karşı tarafa yansır.
"""

import asyncio
import html
import ipaddress
import logging
import re
import socket
import time
from typing import List, Optional
from urllib.parse import urlparse, parse_qs, quote, urljoin

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse, Response
import httpx
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.config import settings
from backend.app.database import get_db
from backend.app.models import CinemaRoom, now_utc
from backend.app.schemas import (
    CinemaRoomCreate,
    CinemaRoomResponse,
    CinemaControl,
    CinemaReaction,
)
from backend.app.websocket_manager import ws_manager
from backend.app.services.film_resolver import resolve_page_video
from backend.app.services.site_stream import resolve_site_stream

logger = logging.getLogger("ahududu.cinema")

router = APIRouter(prefix="/api/cinema", tags=["cinema"])

_http_client: Optional[httpx.AsyncClient] = None


def _get_http_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(
            follow_redirects=True,
            timeout=25.0,
            limits=httpx.Limits(max_connections=40, max_keepalive_connections=20),
        )
    return _http_client


async def close_http_client() -> None:
    global _http_client
    if _http_client is not None and not _http_client.is_closed:
        await _http_client.aclose()
    _http_client = None


def _is_disallowed_ip(ip_obj: ipaddress._BaseAddress) -> bool:
    return (
        ip_obj.is_private
        or ip_obj.is_loopback
        or ip_obj.is_link_local
        or ip_obj.is_reserved
        or ip_obj.is_multicast
        or ip_obj.is_unspecified
    )


async def _is_safe_external_url(url: str) -> bool:
    """Validate an external HTTP(S) URL against SSRF targets."""
    try:
        parsed = urlparse((url or "").strip())
    except Exception:
        return False
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return False
    host = parsed.hostname.strip().lower()
    if host in ("localhost", "0.0.0.0", "169.254.169.254") or host.endswith((".local", ".internal")):
        return False
    try:
        ip_obj = ipaddress.ip_address(host)
        return not _is_disallowed_ip(ip_obj)
    except ValueError:
        pass
    try:
        loop = asyncio.get_running_loop()
        infos = await loop.getaddrinfo(host, None, type=socket.SOCK_STREAM)
        for info in infos:
            addr = info[4][0]
            try:
                if _is_disallowed_ip(ipaddress.ip_address(addr)):
                    return False
            except ValueError:
                continue
    except OSError:
        # DNS may not resolve in offline tests; IP literals and local hostnames are still blocked above
        pass
    return True

# Doğrudan oynatılabilen video dosyaları
VIDEO_EXTENSIONS = (".mp4", ".webm", ".m4v", ".mov", ".ogv", ".ogg", ".mkv", ".m3u8", ".ts")
IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg")

# Site bazlı gömme kuralları: (regex, iframe üretici)
YOUTUBE_REGEX = re.compile(
    r"(?:youtube\.com/(?:watch\?.*?v=|embed/|shorts/|live/)|youtu\.be/)([A-Za-z0-9_\-]{6,})"
)
VIMEO_REGEX = re.compile(r"vimeo\.com/(?:video/)?(\d+)")
DAILYMOTION_REGEX = re.compile(r"dailymotion\.com/(?:video/|embed/video/)([A-Za-z0-9]+)")
TWITCH_REGEX = re.compile(r"twitch\.tv/([A-Za-z0-9_]+)")
BILIBILI_REGEX = re.compile(r"bilibili\.com/video/([A-Za-z0-9]+)")
OKRU_REGEX = re.compile(r"ok\.ru/video/(\d+)")
STREAMABLE_REGEX = re.compile(r"streamable\.com/([A-Za-z0-9]+)")
FACEBOOK_REGEX = re.compile(r"facebook\.com/.+/videos?/")
INSTAGRAM_REGEX = re.compile(r"instagram\.com/(?:reel|p|tv)/")


def _iframe(src: str, allow_fullscreen: bool = True) -> str:
    allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
    if allow_fullscreen:
        allow += "; fullscreen"
    return (
        f'<iframe src="{src}" frameborder="0" allow="{allow}" '
        'allowfullscreen referrerpolicy="origin" style="width:100%;height:100%;border:0"></iframe>'
    )


def resolve_video(raw_url: str) -> dict:
    """Kullanıcının yapıştırdığı linki sayfa içinde oynatılabilir hale getirir."""
    url = (raw_url or "").strip()
    if not url:
        raise HTTPException(status_code=400, detail="Video bağlantısı boş olamaz")

    # Daha önce bozulmuş (https:///api/media/...) kayıtları onar
    url = url.replace("https:///", "/").replace("http:///", "/")

    # Medya kütüphanesi yolu: göreli kalırsa iframe/video kaynağı bozulur.
    if url.startswith("/api/media/") or url.startswith("api/media/"):
        if not url.startswith("/"):
            url = "/" + url
        return {
            "source": "upload",
            "video_url": url,
            "embed_url": None,
            "kind": "file",
            "poster_url": None,
        }

    if not re.match(r"^https?://", url):
        url = "https://" + url

    parsed = urlparse(url)
    host = (parsed.netloc or "").lower().replace("www.", "")
    path = parsed.path or ""
    low = url.lower()

    # Zaten gömme adresi yapıştırılmışsa
    if host.endswith("youtube.com") and "/embed/" in path:
        return {
            "source": "embed",
            "embed_url": url,
            "video_url": url,
            "kind": "embed",
            "poster_url": f"https://img.youtube.com/vi/{path.split('/embed/')[-1].split('?')[0]}/maxresdefault.jpg",
        }

    match = YOUTUBE_REGEX.search(url)
    if match:
        video_id = match.group(1)
        start = parse_qs(parsed.query).get("t", [""])[0]
        embed = f"https://www.youtube.com/embed/{video_id}?rel=0&modestbranding=1"
        if start:
            digits = re.sub(r"\D", "", start)
            if digits:
                embed += f"&start={digits}"
        return {
            "source": "youtube",
            "video_url": url,
            "embed_url": embed,
            "kind": "embed",
            "poster_url": f"https://img.youtube.com/vi/{video_id}/maxresdefault.jpg",
        }

    match = VIMEO_REGEX.search(url)
    if match:
        video_id = match.group(1)
        return {
            "source": "vimeo",
            "video_url": url,
            "embed_url": f"https://player.vimeo.com/video/{video_id}?dnt=1",
            "kind": "embed",
            "poster_url": None,
        }

    match = DAILYMOTION_REGEX.search(url)
    if match:
        video_id = match.group(1)
        return {
            "source": "dailymotion",
            "video_url": url,
            "embed_url": f"https://www.dailymotion.com/embed/video/{video_id}",
            "kind": "embed",
            "poster_url": f"https://www.dailymotion.com/thumbnail/video/{video_id}",
        }

    match = BILIBILI_REGEX.search(url)
    if match:
        bvid = match.group(1)
        return {
            "source": "bilibili",
            "video_url": url,
            "embed_url": f"https://player.bilibili.com/player.html?bvid={bvid}&autoplay=0",
            "kind": "embed",
            "poster_url": None,
        }

    match = OKRU_REGEX.search(url)
    if match:
        video_id = match.group(1)
        return {
            "source": "okru",
            "video_url": url,
            "embed_url": f"https://ok.ru/videoembed/{video_id}",
            "kind": "embed",
            "poster_url": None,
        }

    match = STREAMABLE_REGEX.search(url)
    if match:
        video_id = match.group(1)
        return {
            "source": "streamable",
            "video_url": url,
            "embed_url": f"https://streamable.com/e/{video_id}",
            "kind": "embed",
            "poster_url": None,
        }

    if host.endswith("twitch.tv") and "clips" in path:
        slug = path.rstrip("/").split("/")[-1]
        return {
            "source": "twitch",
            "video_url": url,
            "embed_url": f"https://clips.twitch.tv/embed?clip={slug}&parent=ahududu",
            "kind": "embed",
            "poster_url": None,
        }

    match = TWITCH_REGEX.search(url)
    if match:
        channel = match.group(1)
        return {
            "source": "twitch",
            "video_url": url,
            "embed_url": f"https://player.twitch.tv/?channel={channel}&parent=ahududu",
            "kind": "embed",
            "poster_url": None,
        }

    if FACEBOOK_REGEX.search(url):
        return {
            "source": "facebook",
            "video_url": url,
            "embed_url": f"https://www.facebook.com/plugins/video.php?href={quote(url, safe='')}&show_text=false",
            "kind": "embed",
            "poster_url": None,
        }

    if INSTAGRAM_REGEX.search(url):
        clean = url.split("?")[0].rstrip("/")
        return {
            "source": "instagram",
            "video_url": url,
            "embed_url": f"{clean}/embed",
            "kind": "embed",
            "poster_url": None,
        }

    # Doğrudan video dosyası (mp4, webm, m3u8...) veya medya kütüphanesi yolu
    if low.split("?")[0].endswith(VIDEO_EXTENSIONS) or "/api/media/file/" in low:
        source = "upload" if "/api/media/file/" in low else "link"
        return {
            "source": source,
            "video_url": url,
            "embed_url": None,
            "kind": "file",
            "poster_url": None,
        }

    # Sunucudaki görsel/medya yolu: sayfa içinde oynatılabilir değil, iframe'e gömülmez.
    if url.startswith("/api/media/") or low.split("?")[0].endswith(IMAGE_EXTENSIONS):
        return {
            "source": "image",
            "video_url": url,
            "embed_url": None,
            "kind": "file",
            "poster_url": url,
        }

    # Başarısızsa siteyi iframe içine göm (bazı siteler izin vermez ama deniyoruz)
    if not parsed.netloc:
        # Göreli / geçersiz bir yol hiçbir yerde oynatılamaz; anlamlı hata ver.
        raise HTTPException(status_code=400, detail="Geçerli bir video bağlantısı yapıştır")

    return {
        "source": host or "link",
        "video_url": url,
        "embed_url": url,
        "kind": "embed",
        "poster_url": None,
    }


def _room_payload(room: CinemaRoom) -> dict:
    return {
        "id": room.id,
        "title": room.title,
        "video_url": room.video_url,
        "source": room.source,
        "embed_url": room.embed_url,
        "stream_url": room.stream_url,
        "stream_referer": room.stream_referer,
        "cover_url": room.cover_url,
        "poster_url": room.poster_url,
        "kind": room.kind,
        "created_by": room.created_by,
        "is_playing": bool(room.is_playing),
        "is_active": bool(room.is_active),
        "is_calendar": bool(getattr(room, "is_calendar", False)),
        "showtime_id": getattr(room, "showtime_id", None),
        "position": room.position or 0.0,
        "duration": room.duration or 0.0,
        "updated_by": room.updated_by,
        "last_seen_at": room.last_seen_at.isoformat() if room.last_seen_at else None,
        "created_at": room.created_at.isoformat() if room.created_at else None,
        "updated_at": room.updated_at.isoformat() if room.updated_at else None,
    }


# ---------------------------------------------------------------- deep resolve
# Film siteleri video sayfasını doğrudan iframe'e gömmeye izin vermez. Bu yüzden
# "kullanıcı hangi linki yapıştırırsa yapıştırsın" salonun perdesine gömülebilir
# (YouTube/player) adresi koymak zorundayız. Aşağıdaki yardımcı, bilinmeyen
# siteler için sayfayı sunucu tarafında indirip gerçek oynatıcıyı bulur.
#
# Sonuç kısa süre önbelleklenir: aynı filmi yeniden açmak / salona girmek her
# seferinde siteyi baştan indirmesin.
DEEP_CACHE_TTL_SECONDS = 600
_deep_cache: dict = {}


def _cache_get(key: str) -> Optional[dict]:
    entry = _deep_cache.get(key)
    if not entry:
        return None
    stamp, value = entry
    if time.time() - stamp > DEEP_CACHE_TTL_SECONDS:
        _deep_cache.pop(key, None)
        return None
    return value


def _cache_put(key: str, value: dict) -> None:
    if len(_deep_cache) > 200:  # bellek şişmesin
        _deep_cache.clear()
    _deep_cache[key] = (time.time(), value)


# Gömülebilir olduğu bilinen oynatıcı adresleri (iframe içinde açılır).
PLAYABLE_EMBED_HOSTS = (
    "youtube.com/embed/", "youtube-nocookie.com/embed/", "player.vimeo.com/",
    "dailymotion.com/embed/", "player.bilibili.com/", "ok.ru/videoembed/",
    "streamable.com/e/", "twitch.tv/", "facebook.com/plugins/",
    "instagram.com/", "player.twitch.tv/",
)


def is_playable_embed(url: Optional[str]) -> bool:
    """Adres gömülebilir bir oynatıcı mı? (Aksi: sitenin kendi HTML sayfası)"""
    low = (url or "").lower()
    if not low:
        return False
    return any(host in low for host in PLAYABLE_EMBED_HOSTS)


async def resolve_link_deep(raw_url: str) -> dict:
    """Linki perdeye gömülebilir hale getirir (bilinmeyen siteler için ağ turu).

    Dönüş sözlüğü `resolve_video` ile aynı alanları taşır; ek olarak
    `page_url` / `page_title` gelebilir.
    """
    resolved = resolve_video(raw_url)

    # Dosya (mp4/m3u8/medya kütüphanesi) ya da tanınan oynatıcı: ek iş gerekmez.
    if resolved.get("kind") == "file" or is_playable_embed(resolved.get("embed_url")):
        return resolved
    if not _is_generic_site(resolved, raw_url):
        return resolved

    page_url = resolved.get("video_url") or raw_url
    cached = _cache_get(page_url)
    if cached:
        return cached

    # 1) ASIL YOL: film sitesinin GERÇEK akışını bul.
    #    Film siteleri oynatıcıyı JS ile şifreli olarak kurar; sayfada hazır
    #    <iframe> yoktur. Bu yüzden sayfayı "iframe içindeki site" gibi açıp
    #    gerçek HLS akışına kadar iniyoruz. Akışı bulursak perde kendi
    #    oynatıcımızda oynar (senkron, reklamsız, ses dublajlı).
    try:
        stream = await resolve_site_stream(page_url)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Akış çözümlemesi başarısız: %s", exc)
        stream = None

    if stream is not None and stream.ok and stream.url:
        deep = {
            "source": "stream",
            "video_url": page_url,
            "embed_url": None,
            "kind": "hls" if stream.kind == "hls" else "file",
            "stream_url": stream.url,
            "stream_referer": stream.referer,
            "poster_url": resolved.get("poster_url"),
            "page_url": page_url,
            "page_title": stream.title or None,
        }
        _cache_put(page_url, deep)
        return deep

    # 2) Yedek: sayfa içindeki hazır oynatıcı adresini ara.
    try:
        page_result = await resolve_page_video(page_url)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Sayfa çözümlemesi başarısız: %s", exc)
        page_result = {"ok": False}

    if page_result.get("ok") and page_result.get("url"):
        found = page_result["url"]
        # Film sayfalarındaki YouTube veya Vimeo embed'leri her zaman FRAGMANDIR (trailer).
        # Kullanıcı filmin kendisini aradığı için fragmanı film videosu olarak seçmiyoruz.
        is_trailer = any(t in found.lower() for t in ("youtube.com/embed", "youtu.be", "player.vimeo.com"))
        if not is_trailer:
            if found.lower().endswith((".mp4", ".m3u8", ".webm")):
                deep = {
                    "source": "link",
                    "video_url": found,
                    "embed_url": None,
                    "kind": "file",
                    "poster_url": resolved.get("poster_url"),
                    "page_url": page_url,
                    "page_title": page_result.get("page_title"),
                }
            else:
                deep = {
                    "source": "embed",
                    "video_url": page_url,
                    "embed_url": found,
                    "kind": "embed",
                    "poster_url": resolved.get("poster_url"),
                    "page_url": page_url,
                    "page_title": page_result.get("page_title"),
                }
            _cache_put(page_url, deep)
            return deep

    # Bulunamadı: sayfanın kendisini gömmeyi denemek yerine, kullanıcıya
    # "yeni sekmede aç" sunabilmesi için orijinal sayfayı koruyoruz.
    _cache_put(page_url, resolved)
    return resolved


@router.post("/resolve")
async def resolve_link(payload: dict):
    """Bir video linkini sayfa içinde oynatılabilir adrese çevirir.

    Bilinen siteler (YouTube, Vimeo…) doğrudan çözülür. Bilinmeyen bir film
    sitesiyse sayfa indirilip içindeki gerçek video kaynağı aranır; böylece
    site kendi sayfasını engellediği (X-Frame-Options) durumlarda da film
    uygulama içinde oynatılabilir.
    """
    url = payload.get("video_url") or payload.get("url") or ""
    return await resolve_link_deep(url)


@router.get("/hls")
async def cinema_hls(url: str, referer: Optional[str] = None):
    """HLS akışını tarayıcıya servis eder (master + alt playlist + segment).

    Neden gerekli? Film sitelerinin CDN'leri:
      1. Tarayıcıya CORS başlığı vermez (hls.js doğrudan okuyamaz),
      2. `Referer` doğru değilse segmenti reddeder,
      3. Segmentleri `.jpg` kılığında döndürür (yanlış içerik tipi).

    Bu uç nokta tüm zinciri sunucudan geçirir: m3u8 içerikleri ayrıştırılıp
    alt adresler de bu proxy'ye çevrilir, böylece video perdeye gelir.
    """
    target = (url or "").strip()
    if not target or not await _is_safe_external_url(target):
        raise HTTPException(status_code=400, detail="Geçersiz akış adresi")

    ref_parsed = urlparse(referer) if referer else urlparse(target)
    fetch_headers = {
        "User-Agent": (
            "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36"
        ),
        "Accept": "*/*",
        "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
    }
    if ref_parsed.scheme in ("http", "https") and ref_parsed.netloc:
        fetch_headers["Origin"] = f"{ref_parsed.scheme}://{ref_parsed.netloc}"
    if referer and await _is_safe_external_url(referer):
        fetch_headers["Referer"] = referer

    try:
        client = _get_http_client()
        resp = await client.get(target, headers=fetch_headers, timeout=25.0)
    except Exception as exc:  # noqa: BLE001
        logger.warning("HLS proxy hatası (%s): %s", target, exc)
        raise HTTPException(status_code=502, detail="Akışa ulaşılamadı")

    if resp.status_code >= 400:
        logger.info("HLS proxy %s döndü: %s", resp.status_code, target)
        raise HTTPException(status_code=502, detail=f"Akış {resp.status_code} döndü")

    body = resp.content
    final_url = str(resp.url) or target
    content_type = (resp.headers.get("content-type") or "").lower()
    prefix = "/api/cinema/hls?url="
    ref_part = f"&referer={quote(referer, safe='')}" if referer else ""

    def proxied(raw: str) -> str:
        absolute = urljoin(final_url, raw.strip())
        return f"{prefix}{quote(absolute, safe='')}{ref_part}"

    # ---- Playlist (m3u8): alt adresleri de proxy'ye çevir ----
    head_text = body[:256].lstrip(b"\xef\xbb\xbf \t\r\n").decode("utf-8", "ignore")
    is_playlist = (
        head_text.startswith("#EXTM3U")
        or "#EXT-X-" in head_text
        or "mpegurl" in content_type
    )
    if is_playlist:
        text = body.decode("utf-8", "replace")
        lines = []
        for line in text.splitlines():
            stripped = line.strip()
            if not stripped:
                lines.append(line)
                continue
            if stripped.startswith("#"):
                # #EXT-X-MEDIA / #EXT-X-KEY / #EXT-X-MAP / I-FRAME: URI= alanları
                if "URI=" in stripped:
                    stripped = re.sub(
                        r'URI="([^"]+)"',
                        lambda m: f'URI="{proxied(m.group(1))}"',
                        stripped,
                    )
                lines.append(stripped)
            else:
                lines.append(proxied(stripped))
        rewritten = "\n".join(lines)
        return Response(
            content=rewritten.encode("utf-8"),
            media_type="application/vnd.apple.mpegurl",
            headers={
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "no-cache",
            },
        )

    # ---- Segment / parça: içerik aynen geçer ----
    # Segmentler `.jpg` kılığında gelebilir ama içerik MPEG-TS'tir; tarayıcıya
    # doğru tipi söylemek zorundayız yoksa hls.js parçayı atar.
    media_type = content_type
    head = body[:12]
    if head[:1] == b"\x47":  # MPEG-TS senkron baytı
        media_type = "video/mp2t"
    elif head[:4] == b"\x00\x00\x00\x01" or head[4:8] == b"ftyp":
        media_type = "video/mp4"
    elif not media_type or "image" in media_type:
        media_type = "application/octet-stream"

    return Response(
        content=body,
        media_type=media_type,
        headers={
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "public, max-age=1800",
        },
    )


def _blocked_notice_html(target: str) -> str:
    """Film sitesi bot korumasıyla engellediğinde gösterilecek sayfa.

    Site (Cloudflare "Just a moment...", 403 vb.) içeriği vermediğinde proxy
    eskiden sitenin bomboş meydan okuma sayfasını perdeye koyuyordu: kullanıcı
    bembeyaz bir ekran görüyor ve "video oynamıyor" diyordu. Artık ne olduğunu
    ve ne yapması gerektiğini söyleyen bir kart gösteriyoruz.
    """
    safe_site = html.escape(urlparse(target).netloc or target, quote=True)
    safe_target = html.escape(target, quote=True)
    return f"""<!DOCTYPE html>
    <html lang="tr">
    <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Site açılamadı</title></head>
    <body style="background:#09090b;color:#f4f4f5;font-family:system-ui,-apple-system,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;padding:24px;text-align:center;box-sizing:border-box;">
        <p style="font-size:34px;margin:0 0 10px;">🎬</p>
        <p style="font-size:15px;line-height:1.5;margin:0 0 6px;max-width:440px;">
            <strong>{safe_site}</strong> filmi burada açmaya izin vermedi.
        </p>
        <p style="font-size:12px;line-height:1.5;margin:0 0 18px;max-width:420px;color:#a1a1aa;">
            Site kendi güvenlik kontrolünü gösterdiği için video perdeye gelemedi.
            Filmi sitede açıp bağlantısını kopyalayabilir ya da doğrudan bir YouTube bağlantısı ekleyebilirsin.
        </p>
        <a href="{safe_target}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:11px 22px;background:#f59e0b;color:#18181b;font-weight:bold;text-decoration:none;border-radius:999px;font-size:13px;">
            Siteyi tarayıcıda aç ↗
        </a>
    </body>
    </html>"""


def _looks_blocked(status_code: int, html: str) -> bool:
    """Gelen içerik sitenin gerçek sayfası mı, yoksa bot/güvenlik engeli mi?"""
    if status_code in (401, 403, 429, 503):
        return True
    low = (html or "").lower()
    blocked_markers = (
        "just a moment",
        "cf-browser-verification",
        "cf_chl_",
        "checking your browser",
        "enable javascript and cookies to continue",
        "attention required",
        "access denied",
        "captcha",
    )
    return any(marker in low for marker in blocked_markers)


@router.get("/proxy")
async def cinema_proxy(url: str, referer: Optional[str] = None):
    """Film sitesini iframe içinde güvenle açabilmek için X-Frame-Options engelini kaldırır.

    Sayfadaki CSS/JS yollarının bozulmaması için <base> etiketi ve rahat kaydırma
    için mobil touch stilleri eklenir. Pop-up reklamlar engellenir.

    ÖNEMLİ: film sitelerinin embed oynatıcıları (hdfilmcehennemi.mobi gibi)
    sayfayı yalnızca **iframe içinde** açıldığında verir. Sunucu isteği normal
    bir sayfa isteği gibi gidince 404 dönüyorlardı. Bu yüzden Sec-Fetch-*
    başlıkları iframe'i taklit edecek şekilde gönderiliyor; `referer` ile de
    "hangi sayfadan gömüldü" bilgisi taşınıyor.

    Site bot korumasıyla içeriği vermezse (403 / "Just a moment...") boş sayfa
    yerine ne olduğunu anlatan bir kart döner: perde bembeyaz kalmaz.
    """
    target = (url or "").strip()
    if not target or not await _is_safe_external_url(target):
        raise HTTPException(status_code=400, detail="Geçersiz adres")

    # İframe'i taklit eden başlıklar: embed'lerin çoğu bunlar olmadan 404 verir.
    req_headers = {
        "User-Agent": (
            "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
        "Sec-Fetch-Dest": "iframe",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "cross-site",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
    }
    if referer and await _is_safe_external_url(referer):
        req_headers["Referer"] = referer

    try:
        client = _get_http_client()
        resp = await client.get(target, headers=req_headers, timeout=12.0)

        # Bazı oynatıcılar yalnızca referer'lı ister; referer verilmişse
        # ve hâlâ hata alıyorsak origin ile tekrar dene.
        if resp.status_code >= 400 and referer and await _is_safe_external_url(referer):
            parsed_ref = urlparse(referer)
            retry_headers = dict(req_headers)
            retry_headers["Referer"] = f"{parsed_ref.scheme}://{parsed_ref.netloc}/"
            try:
                resp = await client.get(target, headers=retry_headers, timeout=12.0)
            except Exception:  # noqa: BLE001
                pass

        content_type = resp.headers.get("content-type", "text/html")

        if "text/html" in content_type.lower():
            page_html = resp.text

            # Bot koruması: sitenin gerçek sayfası elimizde değil.
            if _looks_blocked(resp.status_code, page_html):
                logger.info(
                    "Proxy engellendi (%s -> %s): %s", target, resp.status_code, resp.url
                )
                blocked = HTMLResponse(
                    content=_blocked_notice_html(target),
                    status_code=200,  # iframe içinde düzgün görünsün
                )
                blocked.headers["X-Frame-Options"] = "ALLOWALL"
                blocked.headers["Content-Security-Policy"] = "frame-ancestors *"
                blocked.headers["Access-Control-Allow-Origin"] = "*"
                return blocked

            final_url = html.escape(str(resp.url), quote=True)
            base_tag = f'<base href="{final_url}" />'
            injected = f"""
            {base_tag}
            <style>
                html, body {{
                    overflow-y: auto !important;
                    -webkit-overflow-scrolling: touch !important;
                    touch-action: pan-y !important;
                }}
            </style>
            <script>
                try {{
                    window.open = function() {{ console.log("[Ahududu] Pop-up engellendi"); return null; }};
                }} catch (e) {{}}
            </script>
            """
            head_match = re.search(r"<head\b[^>]*>", page_html, re.I)
            html_match = re.search(r"<html\b[^>]*>", page_html, re.I)
            if head_match:
                idx = head_match.end()
                page_html = page_html[:idx] + injected + page_html[idx:]
            elif html_match:
                idx = html_match.end()
                page_html = page_html[:idx] + f"<head>{injected}</head>" + page_html[idx:]
            else:
                page_html = f"<!DOCTYPE html><html><head>{injected}</head><body>{page_html}</body></html>"

            response = HTMLResponse(content=page_html, status_code=resp.status_code)
            response.headers["X-Frame-Options"] = "ALLOWALL"
            response.headers["Content-Security-Policy"] = "frame-ancestors *"
            response.headers["Access-Control-Allow-Origin"] = "*"
            return response
        else:
            return Response(
                content=resp.content,
                media_type=content_type,
                status_code=resp.status_code,
                headers={
                    "X-Frame-Options": "ALLOWALL",
                    "Content-Security-Policy": "frame-ancestors *",
                    "Access-Control-Allow-Origin": "*",
                },
            )
    except Exception as exc:
        logger.warning("Proxy erişim hatası (%s): %s", target, exc)
        safe_target = html.escape(target, quote=True)
        return HTMLResponse(
            f"""<!DOCTYPE html>
            <html>
            <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
            <body style="background:#09090b;color:#f4f4f5;font-family:system-ui,-apple-system,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;padding:20px;text-align:center;">
                <p style="font-size:15px;margin-bottom:12px;">Film sitesi salonda doğrudan açılamadı 🎬</p>
                <a href="{safe_target}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:10px 20px;background:#f59e0b;color:#18181b;font-weight:bold;text-decoration:none;border-radius:999px;font-size:13px;">
                    Siteyi tarayıcıda aç ↗
                </a>
            </body>
            </html>"""
        )


def _is_generic_site(resolved: dict, original_url: str) -> bool:
    """Tanınmayan site mi? (site adını source olarak döndüren durum)"""
    source = (resolved.get("source") or "").lower()
    known = {
        "youtube", "vimeo", "dailymotion", "bilibili", "twitch", "okru",
        "streamable", "facebook", "instagram", "upload", "link",
    }
    return source not in known


@router.get("", response_model=List[CinemaRoomResponse])
async def list_rooms(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(CinemaRoom).order_by(desc(CinemaRoom.is_active), desc(CinemaRoom.updated_at))
    )
    return result.scalars().all()


@router.get("/current", response_model=Optional[CinemaRoomResponse])
async def current_room(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(CinemaRoom).where(CinemaRoom.is_active.is_(True)).order_by(desc(CinemaRoom.updated_at)).limit(1)
    )
    room = result.scalars().first()
    return room


@router.post("", response_model=CinemaRoomResponse)
async def create_room(payload: CinemaRoomCreate, db: AsyncSession = Depends(get_db)):
    """Salona film ekler.

    ÖNEMLİ: İstemci `/resolve` ile zaten perdeye gömülebilir adresi bulduysa
    (`embed_url`) onu AYNEN kullanırız. Burada yeniden `resolve_video` çağırmak
    film sitesinin HTML sayfasını iframe'e gömüyordu; site kendi sayfasını
    çerçeve içinde açmadığı için perde "yükleniyor"da takılı kalıyordu.
    """
    if payload.stream_url:
        # İstemci çözümlemeden gelen GERÇEK akışı geçirdi: aynen kullan.
        resolved = {
            "source": payload.source or "stream",
            "video_url": payload.video_url,
            "embed_url": None,
            "kind": payload.kind or "hls",
            "stream_url": payload.stream_url,
            "stream_referer": payload.stream_referer,
            "poster_url": payload.poster_url,
        }
    elif payload.embed_url:
        resolved = {
            "source": payload.source or "embed",
            "video_url": payload.video_url,
            "embed_url": payload.embed_url,
            "kind": "embed",
            "stream_url": None,
            "stream_referer": None,
            "poster_url": payload.poster_url,
        }
    else:
        resolved = await resolve_link_deep(payload.video_url)

    # Aynı link zaten salonda varsa yenisini açmıyoruz
    existing = await db.execute(
        select(CinemaRoom).where(CinemaRoom.video_url == resolved["video_url"]).limit(1)
    )
    room = existing.scalars().first()

    if room:
        room.title = payload.title.strip() or room.title
        room.kind = resolved.get("kind") or payload.kind or room.kind
        room.cover_url = payload.cover_url or room.cover_url
        room.poster_url = payload.poster_url or resolved["poster_url"] or room.poster_url
        if not payload.is_calendar and getattr(room, "is_calendar", False):
            room.is_calendar = False
            room.showtime_id = None
            if room.created_by not in settings.USER_IDS:
                room.created_by = payload.created_by or "murat"
        # Çözülen GERÇEK akış her zaman kazanır: film sitesinin HTML sayfası
        # perdede açılamadığı için kara ekran bırakıyordu.
        if resolved.get("stream_url"):
            room.video_url = resolved["video_url"]
            room.source = "stream"
            room.embed_url = None
            room.stream_url = resolved["stream_url"]
            room.stream_referer = resolved.get("stream_referer")
            room.kind = resolved.get("kind") or "hls"
        # Film sitesi linki verildiyse odanın adresi sitenin kendisi olmalı;
        # eski kayıttan kalma YouTube fragmanı varsa temizlenir.
        elif _is_generic_site(resolved, resolved.get("video_url", "")):
            room.video_url = resolved["video_url"]
            room.source = resolved["source"]
            room.embed_url = resolved["embed_url"]
            room.stream_url = None
            room.stream_referer = None
            room.kind = "embed"
        elif resolved.get("embed_url") and not is_playable_embed(room.embed_url):
            room.video_url = resolved["video_url"]
            room.source = resolved["source"]
            room.embed_url = resolved["embed_url"]
    else:
        room = CinemaRoom(
            title=payload.title.strip() or "Bizim Filmimiz 🍿",
            video_url=resolved["video_url"],
            source=resolved["source"],
            embed_url=resolved["embed_url"],
            stream_url=resolved.get("stream_url"),
            stream_referer=resolved.get("stream_referer"),
            cover_url=payload.cover_url,
            poster_url=payload.poster_url or resolved["poster_url"],
            # Gömme siteleri (YouTube, Vimeo…) "embed", çözülmüş HLS "hls", doğrudan dosyalar "file"/"film".
            kind=resolved.get("kind") or ("embed" if resolved.get("embed_url") else "film"),
            created_by=payload.created_by or "murat",
            is_playing=False,
            is_active=False,
            is_calendar=bool(payload.is_calendar),
            showtime_id=payload.showtime_id,
            position=0.0,
            duration=0.0,
        )
        db.add(room)

    # Sadece bu film aktif olsun
    all_rooms = await db.execute(select(CinemaRoom))
    for other in all_rooms.scalars().all():
        if other is not room and other.is_active:
            other.is_active = False

    await db.commit()
    await db.refresh(room)

    await ws_manager.broadcast({"type": "cinema_room_created", "room": _room_payload(room)})
    return room


async def _repair_room_if_needed(room: CinemaRoom) -> bool:
    """Eski sürümden kalmış bozuk odayı onarır.

    Bozuk oda: `embed_url` sitenin kendi HTML sayfası (iframe içinde açılmaz).
    Böyle bir oda perdede kara ekran / sonsuz "yükleniyor" gösterir. Adresi bir
    kez daha çözümleyip gerçek akışı bulursak kaydı güncelleriz.

    Akış ZATEN çözülmüşse hiçbir şey yapmayız: her açılışta siteye gitmeyiz.
    """
    if room.stream_url:
        return False
    if room.kind == "file" or not room.embed_url or is_playable_embed(room.embed_url):
        return False
    try:
        resolved = await resolve_link_deep(room.video_url)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Oda onarılamadı (%s): %s", room.id, exc)
        return False

    if resolved.get("stream_url"):
        room.video_url = resolved["video_url"]
        room.source = "stream"
        room.embed_url = None
        room.stream_url = resolved["stream_url"]
        room.stream_referer = resolved.get("stream_referer")
        return True

    if not is_playable_embed(resolved.get("embed_url")):
        return False
    room.video_url = resolved["video_url"]
    room.source = resolved["source"]
    room.embed_url = resolved["embed_url"]
    room.kind = "embed"
    return True


@router.get("/{room_id}/embed")
async def room_embed(room_id: int, db: AsyncSession = Depends(get_db)):
    """Oda için HTML gömme kodu (iframe içinde fullscreen'e izin verir)."""
    room = await db.get(CinemaRoom, room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Salon bulunamadı")
    if await _repair_room_if_needed(room):
        await db.commit()
        await db.refresh(room)
        await ws_manager.broadcast({"type": "cinema_room_created", "room": _room_payload(room)})
    if room.embed_url:
        return {"html": _iframe(room.embed_url), "kind": "embed", "src": room.embed_url}
    return {"html": None, "kind": "file", "src": room.video_url}


@router.post("/{room_id}/start", response_model=CinemaRoomResponse)
async def start_room(room_id: int, payload: dict, db: AsyncSession = Depends(get_db)):
    """Filmi başlat: her iki telefon da yatay sinema salonuna girer.

    SADE MODEL: film hemen oynamaya BAŞLAMAZ. İki cihaz da "hazırım" deyince
    (`/ready`) sunucu ikisine aynı anda "başla" komutu yayınlar. Böylece
    yükleme süresi farkı yüzünden biri 20 saniye geriden başlamaz.
    """
    room = await db.get(CinemaRoom, room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Salon bulunamadı")

    # Perdeyi açmadan önce bozuk kaydı onar: "yükleniyor"da takılmasın.
    await _repair_room_if_needed(room)

    all_rooms = await db.execute(select(CinemaRoom))
    for other in all_rooms.scalars().all():
        other.is_active = False

    room.is_active = True
    # HENÜZ oynamıyor: iki taraf da hazır olunca başlayacak.
    room.is_playing = False
    room.position = 0.0
    room.updated_by = payload.get("user_id", "murat")
    room.last_seen_at = now_utc()
    await db.commit()
    await db.refresh(room)

    # Bu salon için önceki çalışma zamanı durumunu sıfırla.
    clear_room_runtime(room.id)

    await ws_manager.broadcast({
        "type": "cinema_started",
        "room": _room_payload(room),
        "started_by": payload.user_id if hasattr(payload, "user_id") else payload.get("user_id", "murat"),
        "title": room.title,
    })
    return room


# ---------------------------------------------------------------------------
# Hazır olma kapısı: iki cihaz da yükleyince film AYNI ANDA başlar
# ---------------------------------------------------------------------------
#
# SADE MODEL'in 1. kuralı. Kullanıcı: "ikisinde de yüklenecek ki aynı anda
# başlayacak." Bu yüzden `start` anında oynatma başlamaz; her cihaz kendi
# oynatıcısı hazır olunca `/ready` çağırır ve ikisi de hazırsa sunucu tek bir
# `cinema_play` olayı yayınlar. O an ikisi de aynı saniyeden (0) başlar.
#
# Partner çevrimdışıysa veya 5 saniye içinde gelmezse hazır olan taraf başlar.

# room_id -> {user_id: hazır_olma_zamani}
_ready_markers: dict[int, dict[str, float]] = {}
_ready_timers: dict[int, asyncio.Task] = {}
READY_TIMEOUT_SECONDS = 20.0
READY_AUTO_START_SECONDS = 5.0


def clear_room_runtime(room_id: int) -> None:
    """Bir oda yeniden başlatılırken/kapatılırken eski çalışma zamanı izlerini temizle."""
    _device_positions.pop(room_id, None)
    _ready_markers.pop(room_id, None)
    timer = _ready_timers.pop(room_id, None)
    if timer and not timer.done():
        timer.cancel()
    for key in [k for k in _position_requests if k[0] == room_id]:
        entry = _position_requests.pop(key, None)
        fut = entry.get("future") if entry else None
        if fut and not fut.done():
            fut.cancel()


async def _delayed_ready_start(room_id: int, position: float, delay: float = READY_AUTO_START_SECONDS) -> None:
    """Partner kısa süre içinde hazır olmazsa filmi otomatik başlat."""
    try:
        await asyncio.sleep(delay)
        if room_id not in _ready_markers:
            return
        from backend.app.database import AsyncSessionLocal

        async with AsyncSessionLocal() as db:
            room = await db.get(CinemaRoom, room_id)
            if not room or not room.is_active or room.is_playing:
                _ready_markers.pop(room_id, None)
                return
            room.is_playing = True
            room.position = position
            room.updated_at = now_utc()
            await db.commit()
            await db.refresh(room)

        _ready_markers.pop(room_id, None)
        logger.info("Sinema süre doldu, otomatik başlatıldı: room=%s pos=%.1f", room_id, position)
        await ws_manager.broadcast({
            "type": "cinema_play",
            "room_id": room_id,
            "position": position,
            "is_playing": True,
            "started": True,
        })
    except asyncio.CancelledError:
        return
    except Exception as exc:  # noqa: BLE001
        logger.warning("Sinema otomatik başlatma hatası (room=%s): %s", room_id, exc)
    finally:
        current = _ready_timers.get(room_id)
        if current is asyncio.current_task():
            _ready_timers.pop(room_id, None)


@router.post("/{room_id}/ready")
async def mark_ready(room_id: int, payload: dict, db: AsyncSession = Depends(get_db)):
    """Bir cihazın oynatıcısı hazır: ikisi de hazırsa (ya da partner yoksa) filmi başlat."""
    room = await db.get(CinemaRoom, room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Salon bulunamadı")

    if room.is_playing:
        return {"started": True, "position": room.position or 0.0}

    user_id = payload.get("user_id") or "murat"
    position = float(payload.get("position") or 0.0)
    force = bool(payload.get("force"))

    # Bu salon için hazır kayıtları (varsa) — `start` bunları sıfırlamıştı.
    markers = _ready_markers.setdefault(room_id, {})
    markers[user_id] = time.time()

    now = time.time()
    others = [u for u in markers if u != user_id]
    others_ready = any(now - markers[u] < READY_TIMEOUT_SECONDS for u in others)
    partner_id = settings.partner_of(user_id)
    partner_online = bool(ws_manager.active_connections.get(partner_id))

    # İki taraf da hazırsa, bekleme süresi dolduysa, zorlandıysa ya da partner çevrimdışıysa başla.
    waited_long = (now - min(markers.values())) >= READY_AUTO_START_SECONDS
    should_start = others_ready or waited_long or force or not partner_online

    if should_start:
        timer = _ready_timers.pop(room_id, None)
        if timer and not timer.done():
            timer.cancel()
        room.is_playing = True
        room.position = position
        room.updated_at = now_utc()
        await db.commit()
        await db.refresh(room)
        _ready_markers.pop(room_id, None)
        logger.info(
            "Sinema başladı: room=%s pos=%.1f (diğer hazır=%s, süre doldu=%s, online=%s, force=%s)",
            room_id, position, others_ready, waited_long, partner_online, force,
        )

        await ws_manager.broadcast({
            "type": "cinema_play",
            "room_id": room.id,
            "position": position,
            "is_playing": True,
            "started": True,
        })
        return {"started": True, "position": position}

    # İkinci cihaz çevrimiçi: gelmesini bekle, yoksa READY_AUTO_START_SECONDS sonra otomatik başlat.
    existing_timer = _ready_timers.get(room_id)
    if not existing_timer or existing_timer.done():
        _ready_timers[room_id] = asyncio.create_task(
            _delayed_ready_start(room_id, position, READY_AUTO_START_SECONDS)
        )
    return {"started": False, "waiting_for_partner": True}


@router.post("/{room_id}/control", response_model=CinemaRoomResponse)
async def control_room(room_id: int, payload: CinemaControl, db: AsyncSession = Depends(get_db)):
    """Oynat / duraklat / sarma — SADE MODEL.

    Kurallar:
      - `pause`: ikisi de durur, konum kaydedilir.
      - `play`  : GERİDE OLANIN saniyesi esas alınır. İki cihaz da o saniyeye
                  sarılır ve birlikte devam eder.
      - `seek`  : kullanıcı elle sardı; konum güncellenir.
    Oynarken periyodik senkron YOKTUR.
    """
    room = await db.get(CinemaRoom, room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Salon bulunamadı")

    action = (payload.action or "").lower()
    # Bu cihazın bildirdiği konum (varsa).
    reported = float(payload.position) if payload.position is not None else None

    if action == "duration":
        if payload.duration and float(payload.duration) > 0:
            room.duration = float(payload.duration)
            room.updated_at = now_utc()
            await db.commit()
            await db.refresh(room)
        return room

    if action == "seek":
        if getattr(room, "is_calendar", False):
            raise HTTPException(status_code=400, detail="Takvim seanslarında ileri/geri sarma yapılamaz")
        room.position = float(payload.position or 0.0)
    elif action == "play":
        room.is_playing = True
    elif action == "pause":
        room.is_playing = False
    elif action in ("adopt", "join"):
        room.last_seen_at = now_utc()
        if payload.duration and float(payload.duration) > 0:
            room.duration = float(payload.duration)

        # Salonda ZATEN oynayan biri var mı? (bizden başka biri)
        others = [u for u in _device_positions.get(room.id, {}) if u != payload.user_id]
        partner_id = others[0] if others else (settings.partner_of(payload.user_id) if room.is_playing else None)

        was_playing = bool(room.is_playing) and bool(partner_id)

        if was_playing and partner_id:
            # ---- Oynayan taraftan CANLI konum iste (yalnız bu an) ----
            live_pos = await ask_position(room.id, payload.user_id, partner_id)

            if live_pos is not None:
                leader_pos = max(0.0, live_pos)
            else:
                # Yanıt gelmezse son bilinen konuma düş (pause/play/seek anından).
                positions = _device_positions.get(room.id, {})
                leader_pos = max(0.0, positions.get(partner_id, room.position or 0.0))

            room.position = leader_pos
            room.is_playing = True
            room.updated_by = payload.user_id
            room.updated_at = now_utc()
            await db.commit()
            await db.refresh(room)
            logger.info(
                "Salona giriş senkronu: room=%s lider=%s pos=%.1fs (giren=%s, canlı=%s)",
                room.id, partner_id, leader_pos, payload.user_id, live_pos is not None,
            )

            await ws_manager.broadcast({
                "type": "cinema_sync",
                "room_id": room.id,
                "action": "join_sync",
                "position": leader_pos,
                "duration": room.duration,
                "is_playing": True,
                "is_active": room.is_active,
                "updated_by": payload.user_id,
                "updated_at": room.updated_at.isoformat(),
                "behind_by": partner_id,
            })
            return room

        # Salonda kimse oynamıyorsa: sadece "salondayım" bilgisi.
        room.updated_by = payload.user_id
        room.updated_at = now_utc()
        await db.commit()
        await db.refresh(room)
        await ws_manager.broadcast({
            "type": "cinema_sync",
            "room_id": room.id,
            "action": "join",
            "position": room.position,
            "duration": room.duration,
            "is_playing": room.is_playing,
            "is_active": room.is_active,
            "updated_by": room.updated_by,
            "updated_at": room.updated_at.isoformat(),
        })
        return room
    elif action == "leave":
        room.last_seen_at = now_utc()
        room.is_playing = False
        room.is_active = False
        room.updated_by = payload.user_id
        clear_room_runtime(room.id)
        try:
            await set_cinema_presence(payload.user_id, False)
        except Exception as exc:  # noqa: BLE001
            logger.debug('cinema leave presence temizlenemedi: %s', exc)
    elif action == "stop":
        room.is_active = False
        room.is_playing = False
        room.position = 0.0
        clear_room_runtime(room.id)
    elif action == "sync":
        pass
    else:
        raise HTTPException(status_code=400, detail="Bilinmeyen işlem")

    if reported is not None and action in ("pause", "seek"):
        room.position = reported
        _device_positions.setdefault(room.id, {})[payload.user_id] = reported
    elif reported is not None and action == "play":
        _device_positions.setdefault(room.id, {})[payload.user_id] = reported

    # ---- DURDUR: İki tarafta da durdurulur ve karşı tarafın pozisyonu gecikmeden öğrenilir ----
    if action == "pause":
        if payload.duration and float(payload.duration) > 0:
            room.duration = float(payload.duration)
        room.updated_by = payload.user_id
        room.updated_at = now_utc()
        await db.commit()
        await db.refresh(room)

        partner_id = settings.partner_of(payload.user_id)
        partner_online = bool(ws_manager.active_connections.get(partner_id))
        waiter_future: Optional[asyncio.Future] = None
        waiter_entry: Optional[dict] = None
        if partner_online:
            waiter_future = asyncio.get_running_loop().create_future()
            waiter_entry = {"requester": payload.user_id, "future": waiter_future}
            _position_requests[(room.id, partner_id)] = waiter_entry

        await ws_manager.broadcast({
            "type": "cinema_sync",
            "room_id": room.id,
            "action": "pause",
            "position": room.position,
            "duration": room.duration,
            "is_playing": room.is_playing,
            "is_active": room.is_active,
            "updated_by": room.updated_by,
            "updated_at": room.updated_at.isoformat(),
            "behind_by": None,
        })

        if waiter_future is not None:
            try:
                await asyncio.wait_for(waiter_future, timeout=0.5)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                pass
            finally:
                key = (room.id, partner_id)
                if _position_requests.get(key) is waiter_entry:
                    _position_requests.pop(key, None)

        return room

    # ---- OYNAT: Senkronizasyon Modelleri ----
    if action == "play":
        is_calendar = bool(getattr(room, "is_calendar", False))
        positions = _device_positions.setdefault(room.id, {})

        if is_calendar:
            # 1) TAKVİM SEANSI:
            # "Durdurup başlatıldığında eğer bir kişi 11:08 diğeri 11:03 deyse 11:00 dan devam edecek film.
            #  Yani geride olan kişinin 3 saniye gerisinden devam edecek."
            partner_id = settings.partner_of(payload.user_id)
            if partner_id not in positions:
                try:
                    partner_pos = await ask_position(room.id, payload.user_id, partner_id, wait_seconds=0.8)
                    if partner_pos is not None:
                        positions[partner_id] = float(partner_pos)
                except Exception:
                    pass

            if len(positions) >= 2:
                earliest_user = min(positions, key=lambda u: positions[u])
                min_pos = positions[earliest_user]
                room.position = max(0.0, min_pos - 3.0)
                logger.info(
                    "Takvim seansı play: geride olan=%s (%.1fs) -> 3s gerisi: %.1fs",
                    earliest_user, min_pos, room.position,
                )
                behind_by = earliest_user
            elif len(positions) == 1:
                single_pos = list(positions.values())[0]
                room.position = max(0.0, single_pos - 3.0)
                logger.info("Takvim seansı play: tek cihaz (%.1fs) -> 3s gerisi: %.1fs", single_pos, room.position)
                behind_by = payload.user_id
            else:
                room.position = max(0.0, (room.position or 0.0) - 3.0)
                behind_by = None
        else:
            # 2) TAKVİMSİZ HIZLI İZLE:
            # "kim film açarsa yönetici o olsun. Durdurma ve başlatma işlemini iki kişide yapabilsin
            #  ancak süre senkronizasyonu sadece filmi açan kişiye göre senkronize edilsin.
            #  Başlata tıklandığında filmi açan kişiye göre iki kişininde dakikasını eşitlesin."
            leader = room.created_by or "murat"
            if leader in positions:
                room.position = max(0.0, positions[leader])
                logger.info(
                    "Hızlı izle play: yönetici=%s (%.1fs) -> iki kişi de eşitlendi",
                    leader, room.position,
                )
            else:
                # Yöneticinin konumu henüz kayıtlı değilse canlı sor
                try:
                    live_pos = await ask_position(room.id, payload.user_id, leader, wait_seconds=1.0)
                    if live_pos is not None:
                        positions[leader] = float(live_pos)
                        room.position = max(0.0, live_pos)
                    else:
                        room.position = reported if reported is not None else (room.position or 0.0)
                except Exception:
                    room.position = reported if reported is not None else (room.position or 0.0)
                logger.info(
                    "Hızlı izle play: yönetici=%s canlı/son pos=%.1fs -> iki kişi de eşitlendi",
                    leader, room.position,
                )
            behind_by = leader

        # Eşitlenen pozisyonu her iki cihaz için güncelle ki eski değer kalmasın
        for uid in list(positions.keys()):
            positions[uid] = room.position
    else:
        behind_by = None

    if payload.duration and float(payload.duration) > 0:
        room.duration = float(payload.duration)

    room.updated_by = payload.user_id
    room.updated_at = now_utc()
    await db.commit()
    await db.refresh(room)

    await ws_manager.broadcast({
        "type": "cinema_sync",
        "room_id": room.id,
        "action": action,
        "position": room.position,
        "duration": room.duration,
        "is_playing": room.is_playing,
        "is_active": room.is_active,
        "updated_by": room.updated_by,
        "updated_at": room.updated_at.isoformat(),
        "behind_by": behind_by,
    })
    return room


# room_id -> {user_id: son bildirdiği saniye}
# "Oynat"ta geride olanı bulmak için. Oynarken güncellenmez (sadece
# oynat/duraklat/sarma anında) — sürekli checkpoint yok.
_device_positions: dict[int, dict[str, float]] = {}

# Salona giriş senkronu: oynayan taraftan CANLI konum istemek için bekleyenler.
# (room_id, user_id) -> { requester, future }  (WS üzerinden tek tur soru-cevap)
_position_requests: dict[tuple[int, str], dict] = {}


async def ask_position(room_id: int, requester_id: str, user_id: str, wait_seconds: float = 3.0) -> Optional[float]:
    """Oynayan taraftan TEK SEFERLİK canlı konum sor.

    Kullanıcı isteği: "sunucu video zaten eşleneceği anca senkronizasyon
    başlattığında öğrensin sonra senkronize etsin devam etsin."

    Sürekli checkpoint YOK. Yalnızca salona biri girdiğinde bu tek tur
    çalışır: karşı tarafın tarayıcısı o anki saniyesini bir kez bildirir.
    """
    if not ws_manager.active_connections.get(user_id):
        return None

    key = (room_id, user_id)
    prev = _position_requests.get(key)
    if prev:
        old_fut = prev.get("future")
        if old_fut and not old_fut.done():
            old_fut.cancel()

    future: asyncio.Future = asyncio.get_running_loop().create_future()
    entry = {"requester": requester_id, "future": future}
    _position_requests[key] = entry

    await ws_manager.send_to_user(user_id, {
        "type": "cinema_position_request",
        "room_id": room_id,
        "requested_by": requester_id,
    })

    try:
        value = await asyncio.wait_for(future, timeout=wait_seconds)
        return float(value) if value is not None else None
    except (asyncio.TimeoutError, asyncio.CancelledError):
        return None
    finally:
        if _position_requests.get(key) is entry:
            _position_requests.pop(key, None)


def record_device_position(room_id: int, user_id: str, position: float) -> None:
    """Bir kullanıcının salondaki son bildirdiği konumu kaydeder."""
    _device_positions.setdefault(room_id, {})[user_id] = float(position)


def resolve_position(room_id: int, position: float, user_id: Optional[str] = None) -> None:
    """Karşı taraf konumunu bildirdi: bekleyen soruyu yanıtla ve konumu kaydet."""
    if user_id:
        record_device_position(room_id, user_id, position)
        entry = _position_requests.get((room_id, user_id))
        if entry:
            future = entry.get("future")
            if future and not future.done():
                future.set_result(position)
            return

    for key, entry in list(_position_requests.items()):
        if key[0] == room_id:
            future = entry.get("future")
            if future and not future.done():
                future.set_result(position)


@router.post("/{room_id}/react")
async def react_in_room(room_id: int, payload: CinemaReaction):
    """Film sırasında 💕😂😱 uçuşsun."""
    await ws_manager.broadcast({
        "type": "cinema_reaction",
        "room_id": room_id,
        "sender": payload.sender,
        "emoji": payload.emoji,
    })
    return {"success": True}


async def touch_position(room_id: int, position: float, is_playing: bool, user_id: str) -> None:
    """Oynatma sırasındaki periyodik konum bildirimini kaydeder.

    WebSocket üzerinden gelir (HTTP'den çok daha hafif). Sunucudaki konumun
    güncel kalması, salona sonradan giren kişinin filmi doğru saniyeden
    başlatmasını sağlar.
    """
    from backend.app.database import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        room = await db.get(CinemaRoom, room_id)
        if not room or not room.is_active:
            return
        room.position = max(0.0, float(position))
        room.is_playing = bool(is_playing)
        room.updated_by = user_id
        room.last_seen_at = now_utc()
        await db.commit()


async def set_cinema_presence(user_id: str, is_watching: bool, title: Optional[str] = None) -> None:
    """Kişinin Ahududu durumunu "Sinemada 🍿" yapar; çıkınca eski durumuna döner.

    Bu sayede partnerin ana ekranında "Selin — Sinemada 🍿" görünür.
    """
    from backend.app.database import AsyncSessionLocal
    from backend.app.models import UserProfile

    async with AsyncSessionLocal() as db:
        profile = await db.get(UserProfile, user_id)
        if not profile:
            return

        if is_watching:
            # Şu anki durumu sakla (çıkınca geri döneceğiz)
            if not (profile.status_text or "").startswith("Sinemada"):
                presence_memory[user_id] = profile.status_text or ""
            label = f"Sinemada 🍿" + (f" · {title}" if title else "")
            profile.status_text = label[:100]
        else:
            if not (profile.status_text or "").startswith("Sinemada"):
                presence_memory.pop(user_id, None)
                return
            profile.status_text = presence_memory.pop(user_id, "") or ""

        profile.last_seen = now_utc()
        await db.commit()

        # Partnerinizin durum kartı anında güncellensin
        await ws_manager.send_to_user(settings.partner_of(user_id), {
            "type": "partner_profile_updated",
            "profile": {
                "id": profile.id,
                "display_name": profile.display_name,
                "status_text": profile.status_text,
                "battery_level": profile.battery_level,
                "is_charging": profile.is_charging,
                "place_name": profile.place_name,
                "avatar": profile.avatar,
                "last_seen": profile.last_seen.isoformat() if profile.last_seen else None,
            },
        })


# Sinemadayken kaydettiğimiz "eski durum" (bellekte, uygulama ömrü boyunca)
presence_memory: dict = {}


@router.delete("/{room_id}")
async def delete_room(room_id: int, db: AsyncSession = Depends(get_db)):
    room = await db.get(CinemaRoom, room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Salon bulunamadı")
    clear_room_runtime(room_id)
    await db.delete(room)
    await db.commit()
    await ws_manager.broadcast({"type": "cinema_room_deleted", "room_id": room_id})
    return {"success": True}
