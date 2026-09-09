"""Model settings and the shared OpenAI client. Change model/temperature here."""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(override=False)  # real environment variables win over .env

# Confirm the exact id on your account — "gpt-5.5" may differ. Override via the
# LOCKBOX_MODEL env var or the --model flag.
MODEL: str = os.getenv("LOCKBOX_MODEL", "gpt-5.5")
# 0.0 = as deterministic as the API allows (same prompt -> same verdict, mostly).
TEMPERATURE: float = float(os.getenv("LOCKBOX_TEMPERATURE", "0.0"))
# Generous: reasoning models spend part of this budget thinking before the JSON.
MAX_OUTPUT_TOKENS: int = int(os.getenv("LOCKBOX_MAX_TOKENS", "1500"))
# Speech-to-text model for the kiosk mic. Confirm the id on your account.
STT_MODEL: str = os.getenv("LOCKBOX_STT_MODEL", "gpt-4o-transcribe")
# Where the server keeps level progress (gitignored).
_DEFAULT_STATE = Path(__file__).resolve().parent.parent / "state" / "progress.json"
STATE_PATH: Path = Path(os.getenv("LOCKBOX_STATE_PATH", str(_DEFAULT_STATE)))


class MissingAPIKeyError(RuntimeError):
    """Raised when OPENAI_API_KEY is not configured."""


@lru_cache(maxsize=1)
def get_client():
    """Return a shared OpenAI client, created lazily so no-API tools can import this."""
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise MissingAPIKeyError(
            "OPENAI_API_KEY is not set. Copy .env.example to .env and add your key."
        )
    from openai import OpenAI

    # Retry 429s/5xx with backoff so a busy minute never shows up as a BMO glitch.
    return OpenAI(api_key=api_key, max_retries=6)
