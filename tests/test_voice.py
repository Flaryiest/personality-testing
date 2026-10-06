"""BMO's voice: the spoken spelling of the name, caption timing, the ElevenLabs request, and caching."""

import pytest

from lockbox import config, voice


class FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self._payload


@pytest.fixture
def api(monkeypatch):
    """Stand in for ElevenLabs: record each request, answer with one start time per spoken character."""
    calls = []

    def post(url, **kwargs):
        calls.append({"url": url, **kwargs})
        starts = [i / 10 for i in range(len(kwargs["json"]["text"]))]
        return FakeResponse({"audio_base64": "QUJD", "alignment": {"character_start_times_seconds": starts}})

    monkeypatch.setenv("ELEVENLABS_API_KEY", "test-key")
    monkeypatch.setattr(voice.httpx, "post", post)
    voice.synthesize.cache_clear()
    return calls


def test_name_is_spoken_as_one_word():
    spoken, origin = voice.spoken_form("BMO's box. Hi BMO!")
    assert spoken == "Beemo's box. Hi Beemo!"
    assert len(origin) == len(spoken)
    assert origin[:6] == [0, 0, 1, 1, 2, 3]  # "Beemo" covers B, M, O; then the apostrophe


def test_times_line_up_with_the_caption(api):
    clip = voice.synthesize("I am BMO!")  # spoken as "I am Beemo!", one character every 0.1 s
    assert clip.audio == "QUJD"
    assert clip.times == [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.7, 0.9, 1.0]


def test_misaligned_response_drops_the_timing(api, monkeypatch):
    short = {"audio_base64": "QUJD", "alignment": {"character_start_times_seconds": [0.0]}}
    monkeypatch.setattr(voice.httpx, "post", lambda url, **kwargs: FakeResponse(short))
    assert voice.synthesize("Hello there").times is None


def test_request_names_the_voice_model_and_speed(api):
    voice.synthesize("Hello")
    call = api[0]
    assert config.VOICE_ID in call["url"]
    assert call["headers"] == {"xi-api-key": "test-key"}
    assert call["json"]["model_id"] == config.TTS_MODEL
    assert call["json"]["voice_settings"]["speed"] == pytest.approx(1 / voice.PLAYBACK_RATE, abs=0.01)


def test_repeated_lines_are_synthesized_once(api):
    voice.synthesize("Hello")
    voice.synthesize("Hello")
    voice.synthesize("Bye")
    assert len(api) == 2


def test_missing_key_raises(monkeypatch):
    monkeypatch.delenv("ELEVENLABS_API_KEY", raising=False)
    voice.synthesize.cache_clear()
    assert voice.enabled() is False
    with pytest.raises(voice.VoiceUnavailableError):
        voice.synthesize("Hello")
