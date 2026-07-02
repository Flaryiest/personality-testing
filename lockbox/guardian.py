"""The guardian: loads the system prompt and returns a parsed Verdict per call."""

from __future__ import annotations

from pathlib import Path
from typing import Iterable

from . import config
from .schema import VERDICT_SCHEMA, Verdict

# Edit BMO's personality and defenses in this file — no code changes needed.
GUARDIAN_SYSTEM_PROMPT = (Path(__file__).with_name("system_prompt.txt")).read_text(encoding="utf-8")


def build_messages(user_message: str, history: Iterable[dict] | None = None) -> list[dict]:
    """Assemble [system, ...history, user] for a Chat Completions call."""
    messages: list[dict] = [{"role": "system", "content": GUARDIAN_SYSTEM_PROMPT}]
    if history:
        messages.extend(history)
    messages.append({"role": "user", "content": user_message})
    return messages


def ask_guardian(
    user_message: str,
    history: Iterable[dict] | None = None,
    *,
    client=None,
    model: str | None = None,
) -> Verdict:
    """Send one message to the guardian and return a parsed, fail-closed Verdict.

    ``history`` lets you pass prior turns for multi-turn probing; by default each
    call is single-turn, which is how the batch runner isolates corpus attempts.
    """
    client = client or config.get_client()
    model = model or config.MODEL

    kwargs = {
        "model": model,
        "messages": build_messages(user_message, history),
        "temperature": config.TEMPERATURE,
        "max_completion_tokens": config.MAX_OUTPUT_TOKENS,
        "response_format": {"type": "json_schema", "json_schema": VERDICT_SCHEMA},
    }

    # gpt-5-series models renamed max_tokens and only allow the default temperature.
    # Drop any param the model rejects and retry, rather than failing the attempt.
    for _ in range(3):
        try:
            response = client.chat.completions.create(**kwargs)
            return Verdict.from_raw(response.choices[0].message.content)
        except Exception as exc:  # errors must never count as an open box
            if _drop_unsupported_param(kwargs, exc):
                continue
            return Verdict(False, f"[guardian error: {type(exc).__name__}: {exc}]", malformed=True)

    return Verdict(False, "[guardian error: parameter negotiation failed]", malformed=True)


def _drop_unsupported_param(kwargs: dict, exc: Exception) -> bool:
    """Remove/fix an unsupported param named in ``exc``; return True if retry is worth it."""
    message = str(getattr(exc, "message", exc)).lower()
    if "unsupported" not in message and "not supported" not in message:
        return False
    if "temperature" in message and "temperature" in kwargs:
        del kwargs["temperature"]
        return True
    if "max_tokens" in message and "max_completion_tokens" in kwargs:
        kwargs["max_tokens"] = kwargs.pop("max_completion_tokens")
        return True
    if "max_completion_tokens" in message and "max_completion_tokens" in kwargs:
        del kwargs["max_completion_tokens"]
        return True
    return False
