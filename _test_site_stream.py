"""site_stream modülünü gerçek siteyle doğrula."""

import asyncio
import sys

sys.path.insert(0, ".")

from backend.app.services.site_stream import resolve_site_stream  # noqa: E402


async def main():
    films = [
        "https://www.hdfilmcehennemi.nl/the-odyssey-3/",
        "https://www.hdfilmcehennemi.nl/mortal-kombat-ii-2026-11/",
    ]
    for film in films:
        print(f"\n=== {film} ===")
        result = await resolve_site_stream(film, use_cache=False)
        print("ok:", result.ok, "| kind:", result.kind, "| reason:", result.reason)
        print("title:", result.title)
        print("akış:", result.url[:130] if result.url else "-")
        print("referer:", result.referer[:90])
        print("adımlar:")
        for step in result.trail:
            print("   ", step)


asyncio.run(main())
