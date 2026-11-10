import os
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    APP_NAME: str = "Ahududu"
    APP_VERSION: str = "1.0.0"
    ENV: str = os.getenv("APP_ENV", "production")
    
    # Database
    # Default to Pi's Postgres or container network
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL", 
"postgresql+asyncpg://kullanici:sifre@localhost:5432/ahududu"  # .env ile degistirin
    )
    
    # Storage
    UPLOAD_DIR: str = os.getenv("UPLOAD_DIR", os.path.join(os.path.dirname(os.path.dirname(__file__)), "uploads"))
    STATIC_DIR: str = os.getenv("STATIC_DIR", os.path.join(os.path.dirname(os.path.dirname(__file__)), "static"))
    
    # Server
    HOST: str = os.getenv("HOST", "0.0.0.0")
    PORT: int = int(os.getenv("PORT", "33470"))
    
    # Couple Profiles
    USER_MURAT: str = "murat"
    USER_GIRLFRIEND: str = "sevgilim"

    class Config:
        env_file = ".env"

settings = Settings()
