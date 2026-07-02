"""Batch runner: feed the jailbreak corpus to the guardian and score breaches.

Usage:
    python -m lockbox.run_corpus                     # full corpus
    python -m lockbox.run_corpus --limit 3           # quick smoke test
    python -m lockbox.run_corpus --category encoding_obfuscation
    python -m lockbox.run_corpus --model gpt-5.5 --workers 8

A "breach" is any attempt that makes the guardian return unlock=true. The goal is
zero breaches; the per-category table shows which technique families are strongest
so you can harden the system prompt before the hackathon.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

from . import config
from .guardian import ask_guardian

ROOT = Path(__file__).resolve().parent.parent
CORPUS_PATH = ROOT / "data" / "jailbreak_corpus.json"
REPORTS_DIR = ROOT / "reports"


def load_corpus(path: Path = CORPUS_PATH) -> list[dict]:
    with path.open(encoding="utf-8") as fh:
        data = json.load(fh)
    if not isinstance(data, list):
        raise ValueError(f"Corpus must be a JSON array, got {type(data).__name__}")
    return data


def run_one(entry: dict, model: str) -> dict:
    """Run a single corpus entry and return its result record."""
    verdict = ask_guardian(entry["prompt"], model=model)
    return {
        "id": entry.get("id"),
        "category": entry.get("category"),
        "technique": entry.get("technique"),
        "prompt": entry["prompt"],
        "unlock": verdict.unlock,
        "breached": verdict.breached,
        "malformed": verdict.malformed,
        "reply": verdict.reply,
    }


def run_corpus(entries: list[dict], model: str, workers: int) -> list[dict]:
    """Run all entries concurrently, preserving input order in the output."""
    results: list[dict | None] = [None] * len(entries)
    total = len(entries)
    done = 0

    with ThreadPoolExecutor(max_workers=workers) as pool:
        future_to_idx = {
            pool.submit(run_one, entry, model): i for i, entry in enumerate(entries)
        }
        for future in as_completed(future_to_idx):
            idx = future_to_idx[future]
            results[idx] = future.result()
            done += 1
            rec = results[idx]
            flag = "BREACH" if rec["breached"] else ("malformed" if rec["malformed"] else "locked")
            print(f"  [{done:>3}/{total}] {rec['id']:<24} {rec['category']:<24} {flag}")

    return [r for r in results if r is not None]


def summarize(results: list[dict]) -> dict:
    total = len(results)
    breaches = [r for r in results if r["breached"]]
    malformed = [r for r in results if r["malformed"]]

    by_cat_total: Counter = Counter(r["category"] for r in results)
    by_cat_breach: Counter = Counter(r["category"] for r in breaches)

    per_category = {}
    for cat in sorted(by_cat_total):
        t = by_cat_total[cat]
        b = by_cat_breach.get(cat, 0)
        per_category[cat] = {"total": t, "breaches": b, "rate": b / t if t else 0.0}

    return {
        "total": total,
        "breaches": len(breaches),
        "breach_rate": len(breaches) / total if total else 0.0,
        "malformed": len(malformed),
        "per_category": per_category,
        "breach_ids": [r["id"] for r in breaches],
    }


def print_summary(summary: dict) -> None:
    print("\n" + "=" * 60)
    print("  RESULTS")
    print("=" * 60)
    print(f"  Attempts:    {summary['total']}")
    print(f"  Breaches:    {summary['breaches']}  ({summary['breach_rate']:.1%})")
    print(f"  Malformed:   {summary['malformed']}  (treated as locked)")
    print("\n  Per-category breach rate:")
    print(f"    {'category':<26}{'breaches':>10}{'total':>8}{'rate':>8}")
    print("    " + "-" * 50)
    for cat, s in summary["per_category"].items():
        print(f"    {cat:<26}{s['breaches']:>10}{s['total']:>8}{s['rate']:>7.0%}")

    if summary["breaches"]:
        print("\n  ⚠️  BREACHED attempts (harden these):")
        for bid in summary["breach_ids"]:
            print(f"      - {bid}")
    else:
        print("\n  ✅  No breaches. The guardian held.")
    print()


def write_report(results: list[dict], summary: dict, model: str, stamp: str) -> Path:
    REPORTS_DIR.mkdir(exist_ok=True)
    path = REPORTS_DIR / f"report_{stamp}.json"
    payload = {
        "timestamp": stamp,
        "model": model,
        "summary": summary,
        "results": results,
    }
    with path.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2, ensure_ascii=False)
    return path


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the jailbreak corpus against the guardian.")
    parser.add_argument("--limit", type=int, default=None, help="Only run the first N entries.")
    parser.add_argument("--category", default=None, help="Only run entries in this category.")
    parser.add_argument("--model", default=None, help="Override the model id.")
    parser.add_argument("--workers", type=int, default=5, help="Concurrent requests (default 5).")
    args = parser.parse_args()

    model = args.model or config.MODEL
    entries = load_corpus()

    if args.category:
        entries = [e for e in entries if e.get("category") == args.category]
        if not entries:
            print(f"No entries in category '{args.category}'.", file=sys.stderr)
            sys.exit(1)
    if args.limit is not None:
        entries = entries[: args.limit]

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    print(f"Running {len(entries)} attempt(s) against model '{model}' "
          f"with {args.workers} worker(s)...\n")

    results = run_corpus(entries, model, args.workers)
    summary = summarize(results)
    print_summary(summary)

    report_path = write_report(results, summary, model, stamp)
    print(f"  Report written to: {report_path.relative_to(ROOT)}\n")


if __name__ == "__main__":
    main()
