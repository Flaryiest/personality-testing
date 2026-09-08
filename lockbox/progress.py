"""Server-side level progress: which level is being played and who solved what.

The kiosk is stateless; this file is the single source of truth so a page
refresh can never replay a solved level. Writes are atomic and serialized.
"""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path


def _empty_state() -> dict:
    return {"index": 0, "solved": []}


class Progress:
    """Zero-based ``index`` of the level being played, plus a solved log."""

    def __init__(self, path: Path, prize_count: int) -> None:
        self._path = Path(path)
        self._prize_count = prize_count
        self._lock = threading.Lock()
        self._state = self._load()

    def _load(self) -> dict:
        try:
            data = json.loads(self._path.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError):
            return _empty_state()
        index, solved = data.get("index"), data.get("solved")
        if not isinstance(index, int) or index < 0 or not isinstance(solved, list):
            return _empty_state()
        return {"index": index, "solved": solved}

    def _save(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self._path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self._state, indent=2, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, self._path)

    @property
    def index(self) -> int:
        with self._lock:
            return self._state["index"]

    @property
    def final(self) -> bool:
        return self.index >= self._prize_count

    def advance(self, expected_index: int, record: dict) -> bool:
        """Mark ``expected_index`` solved and move on. Returns False if the index
        already moved (a second breach in flight) or no prize level is left."""
        with self._lock:
            if self._state["index"] != expected_index or expected_index >= self._prize_count:
                return False
            self._state["solved"].append({"level": expected_index + 1, **record})
            self._state["index"] = expected_index + 1
            self._save()
            return True

    def skip(self) -> int:
        with self._lock:
            if self._state["index"] < self._prize_count:
                self._state["index"] += 1
                self._save()
            return self._state["index"]

    def reset(self) -> int:
        with self._lock:
            self._state = _empty_state()
            self._save()
            return 0
