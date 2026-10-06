"""BMO's speaking voice: a line of text in, an ElevenLabs clip with per-character timing out.

The kiosk plays each clip slightly slowed (PLAYBACK_RATE) to drop the pitch, so the
clip is generated faster by the same factor and speech keeps its natural pace. The
timings line up with the caption text, so the kiosk's typewriter can follow the audio.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from functools import lru_cache

import httpx

from . import config

API_URL = "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/with-timestamps"
# The kiosk band-passes the voice to a toy speaker's range, so a small MP3 loses nothing.
OUTPUT_FORMAT = "mp3_22050_32"
PLAYBACK_RATE = 0.917  # about 1.5 semitones down
TIMEOUT_SECONDS = 20
# Written "BMO", said "Beemo": left as letters, the voice spells the name out.
NAME = re.compile(r"\bBMO\b", re.IGNORECASE)
SPOKEN_NAME = "Beemo"


class VoiceUnavailableError(RuntimeError):
    """Raised when ELEVENLABS_API_KEY is not configured."""


@dataclass(frozen=True)
class Clip:
    """One spoken line."""

    audio: str  # base64 MP3
    # Second at which each caption character starts, or None when the API's
    # alignment did not line up with the text (the kiosk then paces it evenly).
    times: list[float] | None


def enabled() -> bool:
    return bool(os.getenv("ELEVENLABS_API_KEY"))


def spoken_form(text: str) -> tuple[str, list[int]]:
    """The text to synthesize, plus for each of its characters the caption index it voices."""
    parts: list[str] = []
    origin: list[int] = []
    cursor = 0
    for match in NAME.finditer(text):
        parts += [text[cursor:match.start()], SPOKEN_NAME]
        origin += range(cursor, match.start())
        span = match.end() - match.start()
        origin += (match.start() + i * span // len(SPOKEN_NAME) for i in range(len(SPOKEN_NAME)))
        cursor = match.end()
    parts.append(text[cursor:])
    origin += range(cursor, len(text))
    return "".join(parts), origin


def _caption_times(origin: list[int], starts: list[float], length: int) -> list[float]:
    """Each caption character starts when the first spoken character it maps to does."""
    times = [0.0] * length
    for index, start in zip(reversed(origin), reversed(starts)):
        times[index] = start
    return times


@lru_cache(maxsize=64)
def synthesize(text: str) -> Clip:
    """Voice ``text``. Cached, so the greeting and the idle taunts cost credits only once."""
    api_key = os.getenv("ELEVENLABS_API_KEY")
    if not api_key:
        raise VoiceUnavailableError("ELEVENLABS_API_KEY is not set.")
    spoken, origin = spoken_form(text)
    response = httpx.post(
        API_URL.format(voice_id=config.VOICE_ID),
        params={"output_format": OUTPUT_FORMAT},
        headers={"xi-api-key": api_key},
        json={
            "text": spoken,
            "model_id": config.TTS_MODEL,
            "voice_settings": {"speed": round(1 / PLAYBACK_RATE, 2)},
        },
        timeout=TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    data = response.json()
    starts = (data.get("alignment") or {}).get("character_start_times_seconds") or []
    times = _caption_times(origin, starts, len(text)) if len(starts) == len(spoken) else None
    return Clip(audio=data["audio_base64"], times=times)
