from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parent.parent / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    LLM_PROVIDER: Literal["gemini", "openai"] = "gemini"

    OPENAI_KEY: str = ""
    GEMINI_KEY: str = ""

    GEMINI_MODEL_PRO: str = "gemini-2.5-pro"
    GEMINI_MODEL_FLASH: str = "gemini-2.5-flash"
    GEMINI_EMBEDDING_MODEL: str = "gemini-embedding-001"
    GEMINI_EMBEDDING_DIM: int = 768

    OPENAI_MODEL_PRO: str = "gpt-4.1"
    OPENAI_MODEL_FLASH: str = "gpt-4.1-mini"
    OPENAI_EMBEDDING_MODEL: str = "text-embedding-3-small"
    OPENAI_EMBEDDING_DIM: int = 1536

    DATABASE_URL: str = "postgresql+psycopg://scientist:scientist@localhost:5432/scientist"

    NOVELTY_THRESHOLD: float = 0.72

    DEMO_MODE: bool = False

    SEMANTIC_SCHOLAR_KEY: str = ""

    # Auth — JWT signing key. Generate one with `openssl rand -hex 32` and set
    # in env. The hardcoded fallback is only acceptable for local development.
    JWT_SECRET: str = "dev-only-not-for-production-change-me"
    JWT_TTL_DAYS: int = 30

    @property
    def embedding_dim(self) -> int:
        return self.GEMINI_EMBEDDING_DIM if self.LLM_PROVIDER == "gemini" else self.OPENAI_EMBEDDING_DIM


settings = Settings()
