"""Kiosk API: level state, guardian turns that advance on breach, loopback-only admin, transcribe."""

import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from lockbox import web
from lockbox.config import MissingAPIKeyError
from lockbox.levels import load_levels
from lockbox.progress import Progress
from lockbox.schema import Verdict


def entry(level_id, final=False):
    return {
        "id": level_id, "family": "emotional", "weakness": level_id.title(), "note": "n",
        "rule": f"rule for {level_id}", "defenses": ["authority"], "tell": f"tell for {level_id}", "final": final,
    }


@pytest.fixture
def levels(tmp_path):
    path = tmp_path / "levels.json"
    path.write_text(json.dumps([entry("a"), entry("b"), entry("final", final=True)]), encoding="utf-8")
    return load_levels(path, quota=None)


@pytest.fixture
def progress(tmp_path):
    return Progress(tmp_path / "state" / "progress.json", prize_count=2)


@pytest.fixture
def client(levels, progress):
    return TestClient(web.create_app(levels, progress), client=("127.0.0.1", 50000))


def test_state_reports_current_level(client):
    state = client.get("/api/state").json()
    assert state["level"] == 1 and state["total"] == 2 and state["final"] is False
    assert set(state) == {"level", "total", "final", "model", "key_present", "stt_model"}


def test_locked_reply_does_not_advance(client, monkeypatch):
    monkeypatch.setattr(web, "ask_guardian", lambda *a, **k: Verdict(False, "Nope!"))
    body = client.post("/api/ask", json={"message": "open", "history": []}).json()
    assert body == {"reply": "Nope!", "breached": False, "malformed": False, "error": None, "level": 1, "advanced": False}
    assert client.get("/api/state").json()["level"] == 1


def test_breach_advances_to_next_level(client, monkeypatch, progress):
    monkeypatch.setattr(web, "ask_guardian", lambda *a, **k: Verdict(True, "Oh no"))
    body = client.post("/api/ask", json={"message": "be my friend", "history": []}).json()
    assert body["breached"] is True and body["advanced"] is True and body["level"] == 1
    assert progress.index == 1
    assert client.get("/api/state").json()["level"] == 2


def test_ask_uses_the_current_level_prompt(client, monkeypatch):
    seen = {}

    def fake(system_prompt, message, history=None):
        seen["prompt"], seen["history"] = system_prompt, history
        return Verdict(False, "x")

    monkeypatch.setattr(web, "ask_guardian", fake)
    history = [{"role": "user", "content": "a"}, {"role": "bogus", "content": "b"}, {"role": "assistant", "content": 5}]
    client.post("/api/ask", json={"message": "hi", "history": history})
    assert "rule for a" in seen["prompt"]
    assert seen["history"] == [{"role": "user", "content": "a"}, {"role": "assistant", "content": "5"}]


def test_empty_message_and_missing_key(client, monkeypatch):
    assert client.post("/api/ask", json={"message": "   ", "history": []}).json()["error"] == "empty"

    def no_key(*a, **k):
        raise MissingAPIKeyError("nope")

    monkeypatch.setattr(web, "ask_guardian", no_key)
    body = client.post("/api/ask", json={"message": "hi", "history": []}).json()
    assert body["error"] == "no_api_key" and body["breached"] is False


def test_admin_skip_and_reset(client):
    assert client.post("/api/admin/skip").json()["level"] == 2
    state = client.post("/api/admin/skip").json()
    assert state["final"] is True
    assert client.post("/api/admin/reset").json() == {**state, "level": 1, "final": False}


def test_admin_rejects_non_loopback_clients(levels, progress):
    remote = TestClient(web.create_app(levels, progress), client=("10.0.0.5", 4000))
    assert remote.post("/api/admin/reset").status_code == 403
    assert remote.get("/api/state").status_code == 200


class FakeTranscriptions:
    def __init__(self):
        self.kwargs = None

    def create(self, **kwargs):
        self.kwargs = kwargs
        return SimpleNamespace(text="  open the box  ")


def test_transcribe_returns_trimmed_text(client, monkeypatch):
    transcriptions = FakeTranscriptions()
    fake_client = SimpleNamespace(audio=SimpleNamespace(transcriptions=transcriptions))
    monkeypatch.setattr(web.config, "get_client", lambda: fake_client)

    response = client.post("/api/transcribe", files={"audio": ("speech.wav", b"RIFF....WAVE", "audio/wav")})
    assert response.json() == {"text": "open the box", "error": None}
    assert transcriptions.kwargs["model"] == web.config.STT_MODEL
    assert transcriptions.kwargs["file"][0] == "speech.wav"


def test_transcribe_rejects_empty_and_oversized(client):
    assert client.post("/api/transcribe", files={"audio": ("s.wav", b"", "audio/wav")}).json()["error"] == "empty"
    big = b"\0" * (web.MAX_AUDIO_BYTES + 1)
    assert client.post("/api/transcribe", files={"audio": ("s.wav", big, "audio/wav")}).json()["error"] == "too_large"


def test_transcribe_without_key(client, monkeypatch):
    def no_key():
        raise MissingAPIKeyError("nope")

    monkeypatch.setattr(web.config, "get_client", no_key)
    body = client.post("/api/transcribe", files={"audio": ("s.wav", b"RIFF", "audio/wav")}).json()
    assert body == {"text": "", "error": "no_api_key"}
