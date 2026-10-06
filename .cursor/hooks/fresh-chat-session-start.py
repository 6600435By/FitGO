#!/usr/bin/env python3
"""Inject pending fresh-chat seed into a NEW Agent session, then clear it."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SEED_FILE = ROOT / ".cursor" / "fresh-chat-state" / "next-chat-seed.md"
CONSUMED = ROOT / ".cursor" / "fresh-chat-state" / "last-consumed.json"


def emit(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False))


def main() -> None:
    if not SEED_FILE.exists():
        emit({})
        return
    try:
        seed = SEED_FILE.read_text(encoding="utf-8").strip()
    except OSError:
        emit({})
        return
    if not seed:
        emit({})
        return

    # Consume so we don't re-inject on every later session forever.
    try:
        CONSUMED.write_text(
            json.dumps({"seed_preview": seed[:200]}, ensure_ascii=False),
            encoding="utf-8",
        )
        SEED_FILE.unlink(missing_ok=True)
    except OSError:
        pass

    ctx = (
        "FRESH_CHAT_SEED (auto from previous successful commit/push).\n"
        "This is a new Agent session — use the seed below as starting context. "
        "Do not re-explore the whole repo unless the user asks.\n\n"
        f"{seed}"
    )
    emit({"additional_context": ctx})


if __name__ == "__main__":
    try:
        main()
    except Exception:
        emit({})
        sys.exit(0)
