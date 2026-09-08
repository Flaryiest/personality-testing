"""Fullscreen kiosk face for the guardian, served by FastAPI.

Usage:
    python -m lockbox.web

Then open http://127.0.0.1:8000 and fullscreen it (F11 or the on-screen button).
Conversation history lives in the browser, mirroring chat.py. Level progress
lives on the server in a small JSON file, so a refresh never replays a level.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import config
from .config import MissingAPIKeyError
from .guardian import ask_guardian
from .levels import Level, compose, level_for_index, load_levels, prize_count
from .progress import Progress

LOOPBACK_HOSTS = {"127.0.0.1", "::1"}
MAX_HISTORY_MESSAGES = 24
MAX_MESSAGE_CHARS = 2000
MAX_AUDIO_BYTES = 2_000_000


class AskBody(BaseModel):
    message: str
    history: list[dict] = []


def _clean_history(items: list[dict]) -> list[dict]:
    """Keep only well-formed user/assistant turns, trimmed to the recent window."""
    return [
        {"role": item["role"], "content": str(item["content"])[:4000]}
        for item in items
        if isinstance(item, dict) and item.get("role") in ("user", "assistant") and "content" in item
    ][-MAX_HISTORY_MESSAGES:]


def create_app(levels: list[Level], progress: Progress) -> FastAPI:
    """Build the kiosk app around a level list and a progress store (injectable for tests)."""
    app = FastAPI(title="BMO lockbox kiosk")
    total = prize_count(levels)

    def state_payload() -> dict:
        level = level_for_index(levels, progress.index)
        return {
            "level": level.number,
            "total": total,
            "final": level.final,
            "model": config.MODEL,
            "key_present": bool(os.getenv("OPENAI_API_KEY")),
            "stt_model": config.STT_MODEL,
        }

    def require_loopback(request: Request) -> None:
        if request.client is None or request.client.host not in LOOPBACK_HOSTS:
            raise HTTPException(status_code=403, detail="operator endpoints are local only")

    @app.middleware("http")
    async def no_cache(request: Request, call_next: Callable):
        """Kiosk pages must never go stale: forbid browser caching of the static
        files so edits to the face/dialogue always show up on plain reload."""
        response = await call_next(request)
        if not request.url.path.startswith("/api"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.get("/api/state")
    def state() -> dict:
        return state_payload()

    @app.post("/api/ask")
    def ask(body: AskBody) -> dict:
        """One guardian turn. Always HTTP 200 with the same envelope; ``error`` says
        what went wrong. A breach advances the level before the reply goes out."""
        index = progress.index
        level = level_for_index(levels, index)
        envelope = {
            "reply": "", "breached": False, "malformed": True, "error": None, "level": level.number, "advanced": False,
        }

        message = body.message.strip()[:MAX_MESSAGE_CHARS]
        if not message:
            return {**envelope, "error": "empty"}
        try:
            verdict = ask_guardian(compose(level), message, history=_clean_history(body.history))
        except MissingAPIKeyError:
            return {**envelope, "error": "no_api_key"}
        except Exception as exc:  # ask_guardian fail-closes most errors; belt and braces
            return {**envelope, "error": type(exc).__name__}

        advanced = verdict.breached and progress.advance(
            index,
            {"id": level.id, "at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "message": message},
        )
        return {
            **envelope,
            "reply": verdict.reply,
            "breached": verdict.breached,
            "malformed": verdict.malformed,
            "advanced": advanced,
        }

    @app.post("/api/transcribe")
    def transcribe(audio: UploadFile = File(...)) -> dict:
        """Speech-to-text for the kiosk mic. Same envelope on every path."""
        data = audio.file.read(MAX_AUDIO_BYTES + 1)
        if not data:
            return {"text": "", "error": "empty"}
        if len(data) > MAX_AUDIO_BYTES:
            return {"text": "", "error": "too_large"}
        try:
            result = config.get_client().audio.transcriptions.create(
                model=config.STT_MODEL, file=("speech.wav", data, "audio/wav")
            )
        except MissingAPIKeyError:
            return {"text": "", "error": "no_api_key"}
        except Exception as exc:
            return {"text": "", "error": type(exc).__name__}
        return {"text": result.text.strip(), "error": None}

    @app.post("/api/admin/reset")
    def admin_reset(request: Request) -> dict:
        require_loopback(request)
        progress.reset()
        return state_payload()

    @app.post("/api/admin/skip")
    def admin_skip(request: Request) -> dict:
        require_loopback(request)
        progress.skip()
        return state_payload()

    # Mounted after the API routes so /api/* wins; html=True serves index.html at /.
    app.mount("/", StaticFiles(directory=Path(__file__).with_name("static"), html=True), name="static")
    return app


def default_app() -> FastAPI:
    """The real kiosk: shipped levels, progress in config.STATE_PATH."""
    levels = load_levels()
    return create_app(levels, Progress(config.STATE_PATH, prize_count(levels)))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(default_app(), host="127.0.0.1", port=8000)
