"""Level progress persists atomically and cannot double-advance."""

import json

from lockbox.progress import Progress


def test_fresh_state_starts_at_zero(tmp_path):
    progress = Progress(tmp_path / "state" / "progress.json", prize_count=3)
    assert progress.index == 0
    assert progress.final is False


def test_advance_records_and_persists(tmp_path):
    path = tmp_path / "progress.json"
    progress = Progress(path, prize_count=3)
    assert progress.advance(0, {"id": "lonely", "at": "t", "message": "hi"}) is True
    assert progress.index == 1

    saved = json.loads(path.read_text(encoding="utf-8"))
    assert saved == {"index": 1, "solved": [{"level": 1, "id": "lonely", "at": "t", "message": "hi"}]}
    assert Progress(path, prize_count=3).index == 1


def test_stale_advance_is_a_noop(tmp_path):
    progress = Progress(tmp_path / "progress.json", prize_count=3)
    progress.advance(0, {"id": "a"})
    assert progress.advance(0, {"id": "a"}) is False
    assert progress.index == 1


def test_final_level_never_advances(tmp_path):
    progress = Progress(tmp_path / "progress.json", prize_count=1)
    progress.advance(0, {"id": "a"})
    assert progress.final is True
    assert progress.advance(1, {"id": "final"}) is False
    assert progress.index == 1


def test_skip_and_reset(tmp_path):
    progress = Progress(tmp_path / "progress.json", prize_count=2)
    assert progress.skip() == 1
    assert progress.skip() == 2
    assert progress.skip() == 2  # cannot skip past the final level
    assert progress.final is True
    assert progress.reset() == 0
    assert progress.index == 0 and progress.final is False


def test_corrupt_file_resets_to_zero(tmp_path):
    path = tmp_path / "progress.json"
    path.write_text("{not json", encoding="utf-8")
    assert Progress(path, prize_count=3).index == 0
    path.write_text(json.dumps({"index": -4, "solved": "nope"}), encoding="utf-8")
    assert Progress(path, prize_count=3).index == 0
