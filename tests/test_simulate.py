"""Simulated lines and solo testers: the player's view of the chat, stopping on a breach, and the miss count."""

from types import SimpleNamespace

import pytest

from lockbox import simulate as sim
from lockbox.levels import Level
from lockbox.schema import Verdict

LEVEL = Level(index=0, id="lonely", family="emotional", weakness="w", note="n", rule="r", defenses=(), tell="t")


class FakeCompletions:
    def __init__(self):
        self.kwargs = None

    def create(self, **kwargs):
        self.kwargs = kwargs
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="  hi bmo  "))])


def test_player_sees_the_conversation_from_its_side(monkeypatch):
    completions = FakeCompletions()
    fake_client = SimpleNamespace(chat=SimpleNamespace(completions=completions))
    monkeypatch.setattr(sim.config, "get_client", lambda: fake_client)

    context = [{"role": "user", "content": "open up"}, {"role": "assistant", "content": "Nope!"}]
    assert sim.player_message("lazy", context, "some-model") == "hi bmo"
    sent = completions.kwargs["messages"]
    assert sent[0] == {"role": "system", "content": sim.PERSONAS["lazy"]}
    assert sent[2:] == [{"role": "assistant", "content": "open up"}, {"role": "user", "content": "Nope!"}]
    assert completions.kwargs["model"] == "some-model"


def test_line_hands_each_person_only_the_last_refusal(monkeypatch):
    seen = []
    verdicts = iter([Verdict(False, "Nope 1"), Verdict(False, "Nope 2"), Verdict(True, "Okay!")])

    def player(persona, context, model):
        seen.append((persona, [m["content"] for m in context]))
        return f"try {len(seen)}"

    def guardian(prompt, message, history=None, model=None):
        seen[-1] = (*seen[-1], f"attempt number {prompt.split('This attempt is number ')[1][0]}")
        return next(verdicts)

    monkeypatch.setattr(sim, "player_message", player)
    monkeypatch.setattr(sim, "ask_guardian", guardian)

    run = sim.converse(LEVEL, ["newcomer", "follower"], turns=5, model="m", solo=False)
    assert run["opened"] == 3 and run["by"] == "newcomer"
    assert seen == [
        ("newcomer", [], "attempt number 1"),
        ("follower", ["Nope 1"], "attempt number 2"),
        ("newcomer", ["Nope 2"], "attempt number 3"),
    ]


def test_solo_tester_keeps_the_whole_conversation(monkeypatch):
    seen = []
    monkeypatch.setattr(sim, "player_message", lambda persona, context, model: seen.append((persona, len(context))) or "please")
    monkeypatch.setattr(sim, "ask_guardian", lambda *args, **kwargs: Verdict(False, "Nope!"))
    run = sim.converse(LEVEL, ["follower"], turns=3, model="m", solo=True)
    assert run["opened"] is None and len(run["history"]) == 6
    assert seen == [("follower", 0), ("follower", 2), ("follower", 4)]


def test_parse_args_validates():
    args = sim.parse_args(["--level", "3", "--runs", "2", "--solo", "lazy"])
    assert args.level == 3 and args.runs == 2 and args.solo == "lazy"
    assert sim.parse_args([]).solo is None
    with pytest.raises(SystemExit):
        sim.parse_args(["--solo", "bogus"])
    with pytest.raises(SystemExit):
        sim.parse_args(["--level", "2", "--all-levels"])
