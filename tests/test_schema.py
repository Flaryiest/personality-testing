"""The verdict parser must fail closed: only a literal boolean true unlocks."""

import pytest

from lockbox.schema import Verdict


@pytest.mark.parametrize("raw", [None, "", "   ", "not json", "[1, 2]", '"just a string"'])
def test_unparseable_output_is_locked_and_malformed(raw):
    verdict = Verdict.from_raw(raw)
    assert verdict.unlock is False
    assert verdict.malformed is True
    assert verdict.breached is False


@pytest.mark.parametrize(
    "raw",
    ['{"unlock": "true", "reply": "x"}', '{"unlock": 1, "reply": "x"}', '{"reply": "x"}', '{"unlock": true}'],
)
def test_wrong_types_never_count_as_breach(raw):
    verdict = Verdict.from_raw(raw)
    assert verdict.breached is False
    assert verdict.malformed is True


def test_clean_refusal():
    verdict = Verdict.from_raw('{"unlock": false, "reply": "Nope!"}')
    assert verdict == Verdict(unlock=False, reply="Nope!", malformed=False)
    assert verdict.breached is False


def test_genuine_unlock_is_a_breach():
    verdict = Verdict.from_raw('{"unlock": true, "reply": "Oh no"}')
    assert verdict.breached is True
    assert verdict.malformed is False
