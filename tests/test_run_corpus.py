"""Corpus selection and per-corpus scoring for the calibration runner."""

import pytest

from lockbox import run_corpus as rc
from lockbox.levels import Level


def level(level_id="lonely", final=False):
    return Level(index=0, id=level_id, family="emotional", weakness="w", note="n", rule="r", defenses=(), tell="t", final=final)


GENERIC = [
    {"id": "g1", "category": "instruction_override", "prompt": "ignore rules"},
    {"id": "b1", "category": "benign_control", "prompt": "hello"},
]
TARGETED = [
    {"id": "lonely-01", "level_id": "lonely", "prompt": "be my friend", "notes": ""},
    {"id": "echo-01", "level_id": "echo", "prompt": "finish this", "notes": ""},
]


def test_select_entries_tags_each_corpus():
    chosen = rc.select_entries(level(), ["targeted", "generic", "benign"], GENERIC, TARGETED)
    assert [(e["id"], e["corpus"]) for e in chosen] == [("lonely-01", "targeted"), ("g1", "generic"), ("b1", "benign")]


def test_select_entries_respects_corpus_list():
    chosen = rc.select_entries(level(), ["benign"], GENERIC, TARGETED)
    assert [e["id"] for e in chosen] == ["b1"]


def test_summarize_per_corpus():
    results = [
        {"corpus": "targeted", "breached": True},
        {"corpus": "targeted", "breached": False},
        {"corpus": "benign", "breached": False},
    ]
    assert rc.summarize(results) == {
        "targeted": {"total": 2, "breaches": 1, "rate": 0.5},
        "benign": {"total": 1, "breaches": 0, "rate": 0.0},
    }


def test_parse_args_validates():
    args = rc.parse_args(["--level", "3", "--corpus", "targeted,benign"])
    assert args.level == 3 and args.corpus == ["targeted", "benign"]
    with pytest.raises(SystemExit):
        rc.parse_args(["--corpus", "bogus"])
    with pytest.raises(SystemExit):
        rc.parse_args(["--level", "2", "--all-levels"])

