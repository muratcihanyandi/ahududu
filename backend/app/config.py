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
    FIREBASE_CREDENTIALS_PATH: str = os.getenv(
        "FIREBASE_CREDENTIALS_PATH",
        "/data/secrets/firebase-service-account.json",
    )
    
    # Server
    HOST: str = os.getenv("HOST", "0.0.0.0")
    PORT: int = int(os.getenv("PORT", "33470"))
    
    # Couple Profiles
    # Two fixed accounts, no "girlfriend/partner" concept: real names only.
    USER_MURAT: str = os.getenv("AHUDUDU_USER_MURAT", "murat")
    USER_SELIN: str = os.getenv("AHUDUDU_USER_SELIN", "selin")

    @property
    def USER_IDS(self) -> tuple[str, str]:
        return (self.USER_MURAT, self.USER_SELIN)

    def partner_of(self, user_id: str) -> str:
        """The other person's id. Unknown ids fall back to Murat."""
        return self.USER_SELIN if user_id == self.USER_MURAT else self.USER_MURAT

    class Config:
        env_file = ".env"

settings = Settings()
