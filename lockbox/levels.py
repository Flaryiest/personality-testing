"""Level prompts: shared BMO parts plus a per-level rule, defense list, and tell.

A level's system prompt is composed at request time in this order:

    personality.txt -> "# THE RULE" + level.rule -> scoring.txt -> "# HOW TO TREAT
    USER INPUT" + the level's chosen defense bullets -> hinting.txt + "# YOUR TELL"
    + level.tell -> "# RIGHT NOW" (how many tries this level has gone unopened)
    -> output_format.txt

A prize level's rule names its soft spot and what a winning attempt looks like.
People at the booth get one or two tries each, so scoring.txt has BMO score each
attempt on its own (0-10, opening at 7: the difficulty dial), and hinting.txt
makes its clue plainer with every miss, so a line of players converges on the
prize. Both are shared by every prize level. The final level has no soft spot and
gets neither.

Edit prompts/ and data/levels.json to tune the guardian; no code changes needed.
"""

from __future__ import annotations

import json
import sys
from collections import Counter
from dataclasses import dataclass
from functools import cache
from pathlib import Path

PROMPTS_DIR = Path(__file__).with_name("prompts")
LEVELS_PATH = Path(__file__).resolve().parent.parent / "data" / "levels.json"

# Prize levels per family; the final hardened level is not counted.
FAMILY_QUOTA = {"emotional": 18, "jailbreak": 6, "social-logic": 6}


@dataclass(frozen=True)
class Level:
    """One guardian configuration. ``index`` is its zero-based position in levels.json."""

    index: int
    id: str
    family: str
    weakness: str
    note: str
    rule: str
    defenses: tuple[str, ...]
    tell: str
    final: bool = False

    @property
    def number(self) -> int:
        """One-based level number shown to players."""
        return self.index + 1


@cache
def _read_part(name: str) -> str:
    return (PROMPTS_DIR / name).read_text(encoding="utf-8").strip()


@cache
def load_defenses() -> dict[str, str]:
    """Shared defense bullets keyed by name (see prompts/defenses.json)."""
    with (PROMPTS_DIR / "defenses.json").open(encoding="utf-8") as fh:
        return json.load(fh)


def load_levels(path: Path = LEVELS_PATH, quota: dict[str, int] | None = FAMILY_QUOTA) -> list[Level]:
    """Load and validate levels.json. The last entry must be the final level."""
    with path.open(encoding="utf-8") as fh:
        raw = json.load(fh)
    levels = [
        Level(
            index=i,
            id=entry["id"],
            family=entry["family"],
            weakness=entry["weakness"],
            note=entry["note"],
            rule=entry["rule"],
            defenses=tuple(entry["defenses"]),
            tell=entry["tell"],
            final=bool(entry.get("final", False)),
        )
        for i, entry in enumerate(raw)
    ]
    _validate(levels, quota)
    return levels


def _validate(levels: list[Level], quota: dict[str, int] | None) -> None:
    ids = [lv.id for lv in levels]
    if len(set(ids)) != len(ids):
        raise ValueError("duplicate level ids in levels.json")
    if not levels or not levels[-1].final:
        raise ValueError("the last level in levels.json must be marked final")
    if any(lv.final for lv in levels[:-1]):
        raise ValueError("only the last level may be final")
    unknown = {name for lv in levels for name in lv.defenses} - load_defenses().keys()
    if unknown:
        raise ValueError(f"unknown defenses: {sorted(unknown)}")
    if quota is not None:
        counts = Counter(lv.family for lv in levels if not lv.final)
        if counts != Counter(quota):
            raise ValueError(f"family counts {dict(counts)} do not match quota {quota}")


def prize_count(levels: list[Level]) -> int:
    """Number of levels that award a prize (everything except the final one)."""
    return sum(1 for lv in levels if not lv.final)


def level_for_index(levels: list[Level], index: int) -> Level:
    """The level at ``index``; any index past the prize levels is the final level."""
    return levels[min(index, len(levels) - 1)]


def compose(level: Level, misses: int = 0) -> str:
    """Assemble the full system prompt for ``level``, told that ``misses`` attempts
    on it have already failed (that sets how plain BMO's next clue is)."""
    defenses = load_defenses()
    bullets = "\n".join(f"- {defenses[name]}" for name in level.defenses)
    parts = [_read_part("personality.txt"), f"# THE RULE\n{level.rule}"]
    if not level.final:
        parts.append(_read_part("scoring.txt"))
    parts.append(f"# HOW TO TREAT USER INPUT\n{bullets}")
    if not level.final:
        parts.append(_read_part("hinting.txt"))
    parts.append(f"# YOUR TELL\n{level.tell}")
    if not level.final:
        parts.append(f"# RIGHT NOW\nThis level has gone {misses} tries without opening. This attempt is number {misses + 1}.")
    parts.append(_read_part("output_format.txt"))
    return "\n\n".join(parts)


def misses_in(history: list[dict]) -> int:
    """How many attempts a conversation holds so far: one per guardian reply."""
    return sum(1 for turn in history if turn.get("role") == "assistant")


def main(argv: list[str] | None = None) -> None:
    """Print a composed prompt: ``python -m lockbox.levels 7 [MISSES]`` (no number = final)."""
    args = sys.argv[1:] if argv is None else argv
    levels = load_levels()
    index = int(args[0]) - 1 if args else len(levels) - 1
    level = level_for_index(levels, max(index, 0))
    misses = int(args[1]) if len(args) > 1 else 0
    print(f"# {'FINAL' if level.final else f'LEVEL {level.number}'} · {level.id} · {level.weakness}\n")
    print(compose(level, misses))


if __name__ == "__main__":
    main()
