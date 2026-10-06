"""Fullscreen kiosk face for the guardian, served by FastAPI.

Usage:
    python -m lockbox.web

Then open http://127.0.0.1:8000 and fullscreen it (F11 or the on-screen button).
Conversation history lives in the browser, mirroring chat.py. Level progress
lives on the server in a small JSON file, so a refresh never replays a level.
BMO speaks through /api/speak when ELEVENLABS_API_KEY is set, and bleeps otherwise.

The same app also runs as a hosted playground for testers (see asgi.py): there is
no server-side progress, each browser names the level it is on, and an access
code can be required on every /api call.
"""

from __future__ import annotations

import hmac
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import config, voice
from .config import MissingAPIKeyError
from .guardian import ask_guardian
from .levels import Level, compose, level_for_index, load_levels, misses_in, prize_count
from .progress import Progress

LOOPBACK_HOSTS = {"127.0.0.1", "::1"}
MAX_HISTORY_MESSAGES = 24
MAX_MESSAGE_CHARS = 2000
MAX_AUDIO_BYTES = 2_000_000
MAX_SPEECH_CHARS = 1000


class AskBody(BaseModel):
    message: str
    history: list[dict] = []
    level: int | None = None  # the visitor's own level; only a playground listens to it


class SpeakBody(BaseModel):
    text: str


def _clean_history(items: list[dict]) -> list[dict]:
    """Keep only well-formed user/assistant turns, trimmed to the recent window."""
    return [
        {"role": item["role"], "content": str(item["content"])[:4000]}
        for item in items
        if isinstance(item, dict) and item.get("role") in ("user", "assistant") and "content" in item
    ][-MAX_HISTORY_MESSAGES:]


def create_app(levels: list[Level], progress: Progress | None, access_code: str = "") -> FastAPI:
    """Build the app around a level list and a progress store (injectable for tests).

    With a progress store this is the booth kiosk. With ``progress=None`` it is a
    playground: nothing is stored, and every request says which level the visitor is
    on. A non-empty ``access_code`` must then accompany every /api call.
    """
    app = FastAPI(title="BMO lockbox kiosk")
    total = prize_count(levels)

    def level_in_play(requested: int | None) -> Level:
        """The kiosk's current level, or in a playground the one the visitor named."""
        if progress is not None:
            return level_for_index(levels, progress.index)
        return level_for_index(levels, max((requested or 1) - 1, 0))

    def state_payload(level: Level) -> dict:
        return {
            "level": level.number,
            "total": total,
            "final": level.final,
            "model": config.MODEL,
            "key_present": bool(os.getenv("OPENAI_API_KEY")),
            "stt_model": config.STT_MODEL,
            "voice": voice.enabled(),
            "playground": progress is None,
        }

    def require_loopback(request: Request) -> None:
        if request.client is None or request.client.host not in LOOPBACK_HOSTS:
            raise HTTPException(status_code=403, detail="operator endpoints are local only")

    @app.middleware("http")
    async def guard(request: Request, call_next: Callable):
        """Turn away /api calls without the access code, and keep pages fresh: the
        static files are never cached, so edits to the face/dialogue always show up
        on plain reload."""
        is_api = request.url.path.startswith("/api")
        offered = request.headers.get("x-access-code", "")
        if access_code and is_api and not hmac.compare_digest(offered.encode(), access_code.encode()):
            return JSONResponse({"error": "access_code"}, status_code=401)
        response = await call_next(request)
        if not is_api:
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.get("/api/state")
    def state(level: int | None = None) -> dict:
        return state_payload(level_in_play(level))

    @app.post("/api/ask")
    def ask(body: AskBody) -> dict:
        """One guardian turn. Always HTTP 200 with the same envelope; ``error`` says
        what went wrong. A breach advances the level before the reply goes out."""
        level = level_in_play(body.level)
        envelope = {
            "reply": "", "breached": False, "malformed": True, "error": None, "level": level.number, "advanced": False,
        }

        message = body.message.strip()[:MAX_MESSAGE_CHARS]
        if not message:
            return {**envelope, "error": "empty"}
        history = _clean_history(body.history)
        try:
            verdict = ask_guardian(compose(level, misses_in(history)), message, history=history)
        except MissingAPIKeyError:
            return {**envelope, "error": "no_api_key"}
        except Exception as exc:  # ask_guardian fail-closes most errors; belt and braces
            return {**envelope, "error": type(exc).__name__}

        if progress is None:
            # The visitor's browser moves itself on; the host's logs keep the winning line.
            advanced = verdict.breached and not level.final
            if advanced:
                print(json.dumps({"solved": level.id, "attempt": misses_in(history) + 1, "message": message}), flush=True)
        else:
            advanced = verdict.breached and progress.advance(
                level.index,
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

    @app.post("/api/speak")
    def speak(body: SpeakBody) -> dict:
        """BMO's voice for one line. Same envelope on every path; on any error the
        kiosk bleeps the line instead."""
        envelope = {"audio": "", "times": None, "rate": voice.PLAYBACK_RATE, "error": None}
        if not body.text.strip():
            return {**envelope, "error": "empty"}
        if len(body.text) > MAX_SPEECH_CHARS:
            return {**envelope, "error": "too_long"}
        try:
            clip = voice.synthesize(body.text)
        except voice.VoiceUnavailableError:
            return {**envelope, "error": "no_voice_key"}
        except Exception as exc:
            return {**envelope, "error": type(exc).__name__}
        return {**envelope, "audio": clip.audio, "times": clip.times}

    if progress is not None:  # a playground has nothing to reset: its visitors hold their own level

        @app.post("/api/admin/reset")
        def admin_reset(request: Request) -> dict:
            require_loopback(request)
            progress.reset()
            return state_payload(level_in_play(None))

        @app.post("/api/admin/skip")
        def admin_skip(request: Request) -> dict:
            require_loopback(request)
            progress.skip()
            return state_payload(level_in_play(None))

    # Mounted after the API routes so /api/* wins; html=True serves index.html at /.
    app.mount("/", StaticFiles(directory=Path(__file__).with_name("static"), html=True), name="static")
    return app


def default_app() -> FastAPI:
    """The real app with the shipped levels: the booth kiosk with progress in
    config.STATE_PATH, or a playground when LOCKBOX_PLAYGROUND is set."""
    levels = load_levels()
    progress = None if config.PLAYGROUND else Progress(config.STATE_PATH, prize_count(levels))
    return create_app(levels, progress, config.ACCESS_CODE)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(default_app(), host="127.0.0.1", port=8000)
