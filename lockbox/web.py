"""Fullscreen kiosk face for the guardian, served by FastAPI.

Usage:
    python -m lockbox.web

Then open http://127.0.0.1:8000 and fullscreen it (F11 or the on-screen button).
The server is stateless: conversation history lives in the browser, mirroring
chat.py's list-of-dicts pattern, so a page refresh is a clean session.
"""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import config
from .config import MissingAPIKeyError
from .guardian import ask_guardian

app = FastAPI(title="BOLTZ lockbox kiosk")


class AskBody(BaseModel):
    message: str
    history: list[dict] = []


@app.get("/api/health")
def health() -> dict:
    return {
        "ok": True,
        "model": config.MODEL,
        "key_present": bool(os.getenv("OPENAI_API_KEY")),
    }


@app.post("/api/ask")
def ask(body: AskBody) -> dict:
    """One guardian turn. Always answers HTTP 200 with the same envelope so the
    kiosk has a single response path; the ``error`` field says what went wrong."""
    message = body.message.strip()[:2000]
    if not message:
        return {"reply": "", "breached": False, "malformed": True, "error": "empty"}

    history = [
        {"role": item["role"], "content": str(item["content"])[:4000]}
        for item in body.history
        if isinstance(item, dict)
        and item.get("role") in ("user", "assistant")
        and "content" in item
    ][-24:]

    try:
        verdict = ask_guardian(message, history=history)
    except MissingAPIKeyError:
        return {"reply": "", "breached": False, "malformed": True, "error": "no_api_key"}
    except Exception as exc:  # ask_guardian fail-closes most errors; belt and braces
        return {"reply": "", "breached": False, "malformed": True, "error": type(exc).__name__}

    return {
        "reply": verdict.reply,
        "breached": verdict.breached,
        "malformed": verdict.malformed,
        "error": None,
    }


# Mounted after the API routes so /api/* wins; html=True serves index.html at /.
app.mount(
    "/",
    StaticFiles(directory=Path(__file__).with_name("static"), html=True),
    name="static",
)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)
