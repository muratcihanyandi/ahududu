"""Timezone helpers normalized to Europe/Istanbul (UTC+3)."""

from datetime import date, datetime, timedelta, timezone

try:
    from zoneinfo import ZoneInfo

    ISTANBUL_TZ = ZoneInfo("Europe/Istanbul")
except Exception:  # pragma: no cover - Windows without tzdata
    ISTANBUL_TZ = timezone(timedelta(hours=3))


def now_tr() -> datetime:
    """Current timezone-aware datetime in Europe/Istanbul."""
    return datetime.now(ISTANBUL_TZ)


def today_tr() -> date:
    """Current calendar date in Europe/Istanbul."""
    return now_tr().date()


def to_tr_aware(dt: datetime) -> datetime:
    """Ensure a datetime is timezone-aware in Europe/Istanbul."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=ISTANBUL_TZ)
    return dt.astimezone(ISTANBUL_TZ)
