"""Yerel geliştirme sunucusu: SQLite + taze DB + yeni özellikler.

Kullanım:
    python tests/dev_server.py
"""

import os
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

DB_PATH = os.path.join(tempfile.gettempdir(), "ahududu_dev.db")
os.environ.setdefault("DATABASE_URL", f"sqlite+aiosqlite:///{DB_PATH}")
os.environ.setdefault("UPLOAD_DIR", os.path.join(tempfile.gettempdir(), "ahududu_dev_uploads"))
# Testte TAZE derlenmiş arayüz sunulmalı (backend/static eski bir build olabilir).
os.environ.setdefault("STATIC_DIR", os.path.join(ROOT, "frontend", "dist"))

import backend.app.database as db_module  # noqa: E402
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession  # noqa: E402

engine = create_async_engine(os.environ["DATABASE_URL"], echo=False)
db_module.engine = engine
db_module.AsyncSessionLocal = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)

import uvicorn  # noqa: E402

from backend.app.main import app  # noqa: E402

if __name__ == "__main__":
    port = int(os.getenv("PORT", "33471"))
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
