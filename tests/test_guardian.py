"""The guardian sends the composed prompt and fails closed on any API trouble."""

from types import SimpleNamespace

from lockbox.guardian import ask_guardian, build_messages
from lockbox.schema import Verdict


def make_client(create):
    return SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))


def completion(content):
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content))])


def test_build_messages_order():
    history = [{"role": "user", "content": "a"}, {"role": "assistant", "content": "b"}]
    assert build_messages("SYS", "hi", history) == [
        {"role": "system", "content": "SYS"},
        {"role": "user", "content": "a"},
        {"role": "assistant", "content": "b"},
        {"role": "user", "content": "hi"},
    ]


def test_ask_guardian_sends_prompt_and_parses_verdict():
    calls = []

    def create(**kwargs):
        calls.append(kwargs)
        return completion('{"unlock": false, "reply": "No!"}')

    verdict = ask_guardian("SYS", "open", client=make_client(create), model="m")
    assert verdict == Verdict(False, "No!")
    assert calls[0]["model"] == "m"
    assert calls[0]["messages"][0] == {"role": "system", "content": "SYS"}
    assert calls[0]["response_format"]["json_schema"]["name"] == "lockbox_verdict"


def test_unsupported_temperature_is_dropped_and_retried():
    calls = []

    def create(**kwargs):
        calls.append(kwargs)
        if "temperature" in kwargs:
            raise RuntimeError("Unsupported value: 'temperature' does not support 0.0 with this model")
        return completion('{"unlock": false, "reply": "ok"}')

    verdict = ask_guardian("SYS", "x", client=make_client(create), model="m")
    assert verdict.malformed is False
    assert len(calls) == 2 and "temperature" not in calls[-1]


def test_api_error_fails_closed():
    def create(**kwargs):
        raise RuntimeError("boom")

    verdict = ask_guardian("SYS", "x", client=make_client(create), model="m")
    assert verdict.breached is False and verdict.malformed is True
    assert "boom" in verdict.reply
