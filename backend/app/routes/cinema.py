"""Sinema Salonu — birlikte izleme odası.

Murat ya da Selin herhangi bir siteden bir video linki seçer. Link, sayfa
içinde oynatılabilir (iframe / doğrudan video dosyası) hale getirilir. İki
telefon da aynı filmi aynı saniyede görür: oynat / duraklat / sarma işlemleri
WebSocket üzerinden anında karşı tarafa yansır.
"""

import logging
import re
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
            "embed_url": f"https://www.facebook.com/plugins/video.php?href={url}&show_text=false",
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
    if not target or not target.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="Geçersiz akış adresi")

    fetch_headers = {
        "User-Agent": (
            "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36"
        ),
        "Accept": "*/*",
        "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
        "Origin": "https://" + (urlparse(referer).netloc if referer else urlparse(target).netloc),
    }
    if referer:
        fetch_headers["Referer"] = referer

    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=25.0, headers=fetch_headers) as client:
            resp = await client.get(target)
    except Exception as exc:  # noqa: BLE001
        logger.warning("HLS proxy hatası (%s): %s", target, exc)
        raise HTTPException(status_code=502, detail="Akışa ulaşılamadı")

    if resp.status_code >= 400:
        logger.info("HLS proxy %s döndü: %s", resp.status_code, target)
        raise HTTPException(status_code=502, detail=f"Akış {resp.status_code} döndü")

    body = resp.content
    content_type = (resp.headers.get("content-type") or "").lower()
    prefix = f"/api/cinema/hls?url="
    ref_part = f"&referer={quote(referer, safe='')}" if referer else ""

    def proxied(raw: str) -> str:
        absolute = urljoin(target, raw.strip())
        return f"{prefix}{quote(absolute, safe='')}{ref_part}"

    # ---- Playlist (m3u8): alt adresleri de proxy'ye çevir ----
    is_playlist = (
        "#EXTM3U" in body[:64].decode("utf-8", "ignore")
        or "mpegurl" in content_type
        or target.lower().split("?")[0].endswith((".m3u8", ".txt"))
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
    head = body[:4]
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
    site = urlparse(target).netloc or target
    return f"""<!DOCTYPE html>
    <html lang="tr">
    <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Site açılamadı</title></head>
    <body style="background:#09090b;color:#f4f4f5;font-family:system-ui,-apple-system,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;padding:24px;text-align:center;box-sizing:border-box;">
        <p style="font-size:34px;margin:0 0 10px;">🎬</p>
        <p style="font-size:15px;line-height:1.5;margin:0 0 6px;max-width:440px;">
            <strong>{site}</strong> filmi burada açmaya izin vermedi.
        </p>
        <p style="font-size:12px;line-height:1.5;margin:0 0 18px;max-width:420px;color:#a1a1aa;">
            Site kendi güvenlik kontrolünü gösterdiği için video perdeye gelemedi.
            Filmi sitede açıp bağlantısını kopyalayabilir ya da doğrudan bir YouTube bağlantısı ekleyebilirsin.
        </p>
        <a href="{target}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:11px 22px;background:#f59e0b;color:#18181b;font-weight:bold;text-decoration:none;border-radius:999px;font-size:13px;">
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
    if not target or not target.startswith(("http://", "https://")):
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
    if referer:
        req_headers["Referer"] = referer

    try:
        async with httpx.AsyncClient(
            follow_redirects=True,
            timeout=12.0,
            headers=req_headers,
        ) as client:
            resp = await client.get(target)

            # Bazı oynatıcılar yalnızca referer'lı ister; referer verilmişse
            # ve hâlâ hata alıyorsak origin ile tekrar dene.
            if resp.status_code >= 400 and referer:
                parsed_ref = urlparse(referer)
                retry_headers = dict(req_headers)
                retry_headers["Referer"] = f"{parsed_ref.scheme}://{parsed_ref.netloc}/"
                try:
                    resp = await client.get(target, headers=retry_headers)
                except Exception:  # noqa: BLE001
                    pass

            content_type = resp.headers.get("content-type", "text/html")

            if "text/html" in content_type.lower():
                html = resp.text

                # Bot koruması: sitenin gerçek sayfası elimizde değil.
                if _looks_blocked(resp.status_code, html):
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

                final_url = str(resp.url)
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
                lower_html = html.lower()
                if "<head>" in lower_html:
                    idx = lower_html.find("<head>") + 6
                    html = html[:idx] + injected + html[idx:]
                elif "<html>" in lower_html:
                    idx = lower_html.find("<html>") + 6
                    html = html[:idx] + f"<head>{injected}</head>" + html[idx:]
                else:
                    html = f"<!DOCTYPE html><html><head>{injected}</head><body>{html}</body></html>"

                response = HTMLResponse(content=html, status_code=resp.status_code)
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
        return HTMLResponse(
            f"""<!DOCTYPE html>
            <html>
            <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
            <body style="background:#09090b;color:#f4f4f5;font-family:system-ui,-apple-system,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;padding:20px;text-align:center;">
                <p style="font-size:15px;margin-bottom:12px;">Film sitesi salonda doğrudan açılamadı 🎬</p>
                <a href="{target}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:10px 20px;background:#f59e0b;color:#18181b;font-weight:bold;text-decoration:none;border-radius:999px;font-size:13px;">
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
        room.kind = payload.kind or room.kind
        room.cover_url = payload.cover_url or room.cover_url
        room.poster_url = payload.poster_url or resolved["poster_url"] or room.poster_url
        # Çözülen GERÇEK akış her zaman kazanır: film sitesinin HTML sayfası
        # perdede açılamadığı için kara ekran bırakıyordu.
        if resolved.get("stream_url"):
            room.video_url = resolved["video_url"]
            room.source = "stream"
            room.embed_url = None
            room.stream_url = resolved["stream_url"]
            room.stream_referer = resolved.get("stream_referer")
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
            # Gömme siteleri (YouTube, Vimeo…) "embed", doğrudan dosyalar "film".
            # Karışık durumlar için embed_url varlığı oynatıcıyı belirler.
            kind=("embed" if resolved.get("embed_url") else "film"),
            created_by=payload.created_by or "murat",
            is_playing=False,
            is_active=False,
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
    """Filmi başlat: her iki telefon da yatay sinema salonuna girer."""
    room = await db.get(CinemaRoom, room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Salon bulunamadı")

    # Perdeyi açmadan önce bozuk kaydı onar: "yükleniyor"da takılmasın.
    await _repair_room_if_needed(room)

    all_rooms = await db.execute(select(CinemaRoom))
    for other in all_rooms.scalars().all():
        other.is_active = False

    room.is_active = True
    room.is_playing = True
    room.position = 0.0
    # Bilinen süre korunur (aynı film yeniden başlatıldığında ilerleme çubuğu bozulmasın)
    room.updated_by = payload.get("user_id", "murat")
    room.last_seen_at = now_utc()
    await db.commit()
    await db.refresh(room)

    await ws_manager.broadcast({
        "type": "cinema_started",
        "room": _room_payload(room),
        "started_by": payload.get("user_id", "murat"),
        "title": room.title,
    })
    return room


@router.post("/{room_id}/control", response_model=CinemaRoomResponse)
async def control_room(room_id: int, payload: CinemaControl, db: AsyncSession = Depends(get_db)):
    """Oynat / duraklat / sarma — partnerin ekranına anında yansır."""
    room = await db.get(CinemaRoom, room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Salon bulunamadı")

    action = (payload.action or "").lower()
    if action == "play":
        room.is_playing = True
    elif action == "pause":
        room.is_playing = False
    elif action == "seek":
        room.position = float(payload.position or 0.0)
    elif action in ("adopt", "join"):
        # Salona yeni katılan taraf, kimsenin ekranını oynatmaz: sadece
        # "salondayım" bilgisini tazeler. Konum oynatıcıda zaten senkronlanır.
        room.last_seen_at = now_utc()
    elif action == "leave":
        # Salondan çıkan kişi filmi duraklatır. İki taraf da çıktıysa salon kapanır;
        # böylece kimse izlemediği halde "oynuyor" görünen bir film kalmaz.
        room.last_seen_at = now_utc()
        room.is_playing = False
        room.is_active = False
        room.updated_by = payload.user_id
        # Profildeki 'Sinemada' durumu ANINDA temizlensin.
        # WS mesaji kaybolsa/gecikse bile HTTP yolu tek basina yeterli olsun.
        try:
            await set_cinema_presence(payload.user_id, False)
        except Exception as exc:  # noqa: BLE001
            logger.debug('cinema leave presence temizlenemedi: %s', exc)
    elif action == "stop":
        room.is_active = False
        room.is_playing = False
        room.position = 0.0
    elif action == "sync":
        # Sadece oynatma durumunu/pozisyonunu tazele (yeni gelen tarafın isteği)
        pass
    else:
        raise HTTPException(status_code=400, detail="Bilinmeyen işlem")

    if payload.position is not None and action in ("play", "pause", "seek"):
        room.position = float(payload.position)
    # Süre hiçbir zaman sıfıra geri yazılmaz: iki telefonun aynı anda
    # bildirim göndermesi durumunda bile bilinen süre korunur.
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
    })
    return room


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
            profile.status_text = presence_memory.get(user_id, "") or ""
            presence_memory.pop(user_id, None)

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
    await db.delete(room)
    await db.commit()
    await ws_manager.broadcast({"type": "cinema_room_deleted", "room_id": room_id})
    return {"success": True}
