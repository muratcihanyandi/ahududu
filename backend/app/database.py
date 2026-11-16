import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy import inspect, text
from sqlalchemy.orm import declarative_base
from backend.app.config import settings

# Handle SQLite vs Postgres URL formats if local development needs fallback
db_url = settings.DATABASE_URL
if db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql+asyncpg://", 1)
elif db_url.startswith("postgresql://") and not db_url.startswith("postgresql+asyncpg://"):
    db_url = db_url.replace("postgresql://", "postgresql+asyncpg://", 1)

engine = create_async_engine(
    db_url,
    echo=False,
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=20
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False
)

Base = declarative_base()

async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()


# Var olan tablolara `create_all` yeni kolon EKLEMEZ. Aşağıdaki küçük
# eklemeler idempotenttir: kolon zaten varsa hiçbir şey yapılmaz.
# Örnek: mektup arşivi (mektuplar asla kaybolmasın)
COLUMN_ADDITIONS = {
    "love_letters": [
        ("is_deleted", "BOOLEAN DEFAULT FALSE"),
        ("deleted_at", "TIMESTAMP WITH TIME ZONE"),
    ],
}


async def _sync_columns(conn) -> None:
    def inspect_tables(sync_conn):
        inspector = inspect(sync_conn)
        existing = {}
        for table_name in COLUMN_ADDITIONS:
            if inspector.has_table(table_name):
                existing[table_name] = {
                    column["name"] for column in inspector.get_columns(table_name)
                }
        return existing

    columns_by_table = await conn.run_sync(inspect_tables)
    for table_name, additions in COLUMN_ADDITIONS.items():
        if table_name not in columns_by_table:
            continue
        existing_columns = columns_by_table[table_name]
        for column_name, ddl_type in additions:
            if column_name in existing_columns:
                continue
            await conn.execute(
                text(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {ddl_type}")
            )
            print(f"[Ahududu] {table_name}.{column_name} kolonu eklendi")


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        try:
            await _sync_columns(conn)
        except Exception as e:  # noqa: BLE001 - şema uyarısı sunucuyu düşürmesin
            print(f"[Ahududu] Şema güncelleme uyarısı: {e}")
