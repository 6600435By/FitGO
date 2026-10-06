#!/usr/bin/env python3
"""After successful git commit/push: seed next Agent chat + nudge current one to stop."""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
STATE_DIR = ROOT / ".cursor" / "fresh-chat-state"
SEED_FILE = STATE_DIR / "next-chat-seed.md"
DEBOUNCE_FILE = STATE_DIR / "last-trigger.json"
DEBOUNCE_SEC = 90

COMMIT_RE = re.compile(
    r"(^|[;&|\n])\s*git\s+commit\b",
    re.IGNORECASE | re.MULTILINE,
)
PUSH_RE = re.compile(
    r"(^|[;&|\n])\s*git\s+push\b",
    re.IGNORECASE | re.MULTILINE,
)


def emit(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False))


def parse_stdin() -> dict:
    raw = sys.stdin.read()
    if not raw.strip():
        return {}
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {}


def command_from(data: dict) -> str:
    tool_input = data.get("tool_input")
    if isinstance(tool_input, str):
        try:
            tool_input = json.loads(tool_input)
        except json.JSONDecodeError:
            return tool_input
    if isinstance(tool_input, dict):
        cmd = tool_input.get("command")
        if isinstance(cmd, str):
            return cmd
    cmd = data.get("command")
    return cmd if isinstance(cmd, str) else ""


def exit_code(data: dict) -> int | None:
    out = data.get("tool_output")
    if isinstance(out, dict):
        for key in ("exitCode", "exit_code", "code", "status"):
            if key in out and out[key] is not None:
                try:
                    return int(out[key])
                except (TypeError, ValueError):
                    pass
    if isinstance(out, str):
        try:
            parsed = json.loads(out)
        except json.JSONDecodeError:
            parsed = None
        if isinstance(parsed, dict):
            for key in ("exitCode", "exit_code", "code", "status"):
                if key in parsed and parsed[key] is not None:
                    try:
                        return int(parsed[key])
                    except (TypeError, ValueError):
                        pass
        # Heuristic failure markers
        low = out.lower()
        if "error:" in low or "failed" in low[:400]:
            if "nothing to commit" in low:
                return 1
    # afterShellExecution may omit structured exit — treat empty failure heuristics as ok
    return 0


def git(*args: str) -> str:
    try:
        r = subprocess.run(
            ["git", *args],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=8,
            check=False,
        )
        return (r.stdout or "").strip()
    except (OSError, subprocess.TimeoutExpired):
        return ""


def debounced() -> bool:
    if not DEBOUNCE_FILE.exists():
        return False
    try:
        prev = json.loads(DEBOUNCE_FILE.read_text(encoding="utf-8"))
        return (time.time() - float(prev.get("ts", 0))) < DEBOUNCE_SEC
    except (OSError, ValueError, json.JSONDecodeError, TypeError):
        return False


def notify(title: str, body: str) -> None:
    # Best-effort macOS notification; never fail the hook.
    script = (
        f'display notification {json.dumps(body)} '
        f'with title {json.dumps(title)}'
    )
    try:
        subprocess.run(
            ["osascript", "-e", script],
            capture_output=True,
            timeout=5,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        pass


def copy_to_clipboard(text: str) -> None:
    try:
        p = subprocess.run(
            ["pbcopy"],
            input=text.encode("utf-8"),
            capture_output=True,
            timeout=5,
            check=False,
        )
        _ = p.returncode
    except (OSError, subprocess.TimeoutExpired):
        pass


def build_seed(kind: str, command: str) -> str:
    branch = git("rev-parse", "--abbrev-ref", "HEAD") or "?"
    sha = git("rev-parse", "--short", "HEAD") or "?"
    subject = git("log", "-1", "--pretty=%s") or "(no subject)"
    status = git("status", "-sb") or ""
    kind_ru = "push" if kind == "push" else "commit"

    return f"""# FitGO · продолжение после {kind_ru}

Контекст прошлого чата сброшен специально (экономия токенов).

## Только что в git
- Ветка: `{branch}`
- SHA: `{sha}`
- Сообщение: {subject}
- Команда: `{command[:180]}`
- status:
```
{status[:800]}
```

## Задача в этом чате
(вставь сюда следующую фичу / баг одной фразой)

## Правила
- Один workstream-блок за раз (B0–B10), если не сказано иначе.
- Не перечитывай весь репозиторий — начинай с указанных путей.
"""


def main() -> None:
    data = parse_stdin()
    command = command_from(data)
    if not command:
        emit({})
        return

    is_commit = bool(COMMIT_RE.search(command))
    is_push = bool(PUSH_RE.search(command))
    if not (is_commit or is_push):
        emit({})
        return

    code = exit_code(data)
    if code not in (0, None):
        emit({})
        return

    # Failed commit often still exit 0 with "nothing to commit" in some wrappers —
    # skip empty commits.
    tool_out = data.get("tool_output") or data.get("output") or ""
    out_s = tool_out if isinstance(tool_out, str) else json.dumps(tool_out)
    if is_commit and re.search(r"nothing to commit", out_s, re.I):
        emit({})
        return

    if debounced():
        emit({})
        return

    kind = "push" if is_push else "commit"
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    seed = build_seed(kind, command)
    SEED_FILE.write_text(seed, encoding="utf-8")
    DEBOUNCE_FILE.write_text(
        json.dumps({"ts": time.time(), "kind": kind}, ensure_ascii=False),
        encoding="utf-8",
    )

    copy_to_clipboard(seed)
    notify(
        "FitGO · новый Agent-чат",
        "Seed в буфере. Открой новый Agent и ⌘V (или просто новый чат — seed подхватится).",
    )

    ctx = (
        "FRESH_CHAT_REQUIRED after successful git "
        f"{kind}.\n"
        "Cursor cannot open a new Agent tab automatically. Do this now:\n"
        "1) End your reply with the «Новый чат» block from "
        "`.cursor/skills/fresh-chat/SKILL.md`.\n"
        "2) Include a short paste-ready next-task prompt (or say seed is already "
        f"on the clipboard / in `{SEED_FILE.relative_to(ROOT)}`).\n"
        "3) Do not start unrelated new work in THIS chat. Stop after the handoff.\n"
        "4) Tell the user: open a new Agent chat (Composer/Agent). "
        "sessionStart will inject the seed automatically if present."
    )
    emit({"additional_context": ctx})


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Fail open — never break the agent tool loop.
        emit({})
        sys.exit(0)
