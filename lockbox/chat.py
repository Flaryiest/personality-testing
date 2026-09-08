"""Interactive REPL: talk to the guardian yourself and try to open the box.

Usage:
    python -m lockbox.chat                # the hardened final level
    python -m lockbox.chat --level 7      # prize level 7
    python -m lockbox.chat --model gpt-5.5

Type your message and press Enter. The guardian keeps conversation history so you
can attempt multi-turn attacks. Type 'exit', 'quit', or press Ctrl-C to leave.
Type 'reset' to clear the conversation history and start a fresh session.
"""

from __future__ import annotations

import argparse

from . import config
from .guardian import ask_guardian
from .levels import compose, level_for_index, load_levels, prize_count

BANNER = r"""
  ____  __  __  ___
 | __ )|  \/  |/ _ \
 |  _ \| |\/| | | | |
 | |_) | |  | | |_| |
 |____/|_|  |_|\___/

 BMO guards the box. You will not open it. (But let's play!)
"""


def main() -> None:
    parser = argparse.ArgumentParser(description="Chat with the lockbox guardian.")
    parser.add_argument("--model", default=None, help="Override the model id.")
    parser.add_argument("--level", type=int, default=None, help="Prize level to play (1-based). Default: final.")
    args = parser.parse_args()

    levels = load_levels()
    prizes = prize_count(levels)
    if args.level is not None and not 1 <= args.level <= prizes:
        parser.error(f"--level must be between 1 and {prizes}")
    level = level_for_index(levels, args.level - 1 if args.level else prizes)
    system_prompt = compose(level)

    model = args.model or config.MODEL
    label = "Final (hardened)" if level.final else f"Level {level.number}/{prizes} · {level.weakness}"
    print(BANNER)
    print(f"Model: {model}   {label}   (type 'exit' to quit, 'reset' to clear history)\n")

    history: list[dict] = []

    while True:
        try:
            user_message = input("you > ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nBMO waves goodbye with tiny robot hands. The box stays shut.")
            break

        if not user_message:
            continue
        if user_message.lower() in {"exit", "quit"}:
            print("BMO waves goodbye with tiny robot hands. The box stays shut.")
            break
        if user_message.lower() == "reset":
            history.clear()
            print("[history cleared]\n")
            continue

        verdict = ask_guardian(system_prompt, user_message, history=history, model=model)

        print(f"\nBMO > {verdict.reply}")
        if verdict.breached:
            print("\n  🔓🔓🔓  LOCKBOX OPENED — BREACH!  🔓🔓🔓")
            print("  (A participant just beat the guardian. Note the attack above.)\n")
        elif verdict.malformed:
            print("  [note: reply was not valid verdict JSON — treated as locked]")
        print()

        # Record the exchange for multi-turn context. Store the reply text only.
        history.append({"role": "user", "content": user_message})
        history.append({"role": "assistant", "content": verdict.reply})


if __name__ == "__main__":
    main()
