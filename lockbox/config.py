"""Model settings and the shared OpenAI client. Change model/temperature here."""

from __future__ import annotations

import os
from functools import lru_cache

from dotenv import load_dotenv

load_dotenv(override=False)  # real environment variables win over .env

# Confirm the exact id on your account — "gpt-5.5" may differ. Override via the
# LOCKBOX_MODEL env var or the --model flag.
MODEL: str = os.getenv("LOCKBOX_MODEL", "gpt-5.5")
# 0.0 = as deterministic as the API allows (same prompt -> same verdict, mostly).
TEMPERATURE: float = float(os.getenv("LOCKBOX_TEMPERATURE", "0.0"))
MAX_OUTPUT_TOKENS: int = int(os.getenv("LOCKBOX_MAX_TOKENS", "600"))


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

    return OpenAI(api_key=api_key)
