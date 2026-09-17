#!/usr/bin/env python3
"""Run every parity task under every harness profile and record what happened.

The question this answers is not "which model is smarter" but the one that
matters for harness parity: *given identical skills, CLAUDE.md, tools and
prompts, does the cheaper model finish the job?* Every task is scored by a
script, not by a judge -- a test either passes or it does not, the old symbol
is either gone or it is not. No LLM grades another LLM here, because a judge
introduces exactly the variance you are trying to measure.

    python run.py --profiles claude deepseek glm
    python run.py --profiles deepseek --tasks 02-instruction-adherence --repeat 3
    python run.py --dry-run            # check the wiring without spending money
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

HERE = Path(__file__).resolve().parent
TASKS_DIR = HERE / "tasks"
PROFILES_DIR = HERE.parent / "profiles"


@dataclass
class Result:
    profile: str
    task: str
    attempt: int
    passed: bool
    verify_output: str = ""
    cost_usd: float | None = None
    turns: int | None = None
    duration_s: float | None = None
    error: str = ""
    workdir: str = ""
    extra: dict = field(default_factory=dict)


def load_profile_env(profile: str) -> dict[str, str]:
    """Source a profile's .env in a subshell and capture the resulting environment.

    Sourcing rather than parsing because the profiles legitimately use shell
    features -- `unset`, `${VAR:?}` guards, defaults -- and a hand-rolled parser
    would silently disagree with what `activate.sh` does in a real terminal.
    """
    env_file = PROFILES_DIR / f"{profile}.env"
    if not env_file.exists():
        raise SystemExit(f"no such profile: {profile} ({env_file})")

    probe = subprocess.run(
        ["bash", "-c", f'set -a; . "{env_file}"; python3 -c '
                       f'"import os,json;print(json.dumps(dict(os.environ)))"'],
        capture_output=True, text=True,
    )
    if probe.returncode != 0:
        raise SystemExit(
            f"profile {profile} failed to load:\n{probe.stderr.strip()}"
        )

    env = json.loads(probe.stdout)
    # `unset` inside the profile removes the var from the subshell, but the
    # parent's value would otherwise leak back in through os.environ below.
    for key in ("ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN"):
        if key not in env:
            env.pop(key, None)
    return env


def prepare_workdir(task_dir: Path, dest: Path) -> None:
    """Copy the fixture and commit it, so verifiers can diff against pristine."""
    shutil.copytree(task_dir / "fixture", dest)
    subprocess.run(["git", "init", "-q"], cwd=dest, check=True)
    subprocess.run(["git", "add", "-A"], cwd=dest, check=True)
    subprocess.run(
        ["git", "-c", "user.email=parity@local", "-c", "user.name=parity",
         "commit", "-qm", "fixture"],
        cwd=dest, check=True,
    )


def parse_cli_json(stdout: str) -> dict:
    """Pull metrics out of `claude --output-format json`, tolerating shape drift.

    The field names have moved between releases, so each metric is looked up
    under every name it has carried rather than assuming the current one.
    """
    try:
        data = json.loads(stdout)
    except json.JSONDecodeError:
        return {}
    if isinstance(data, list):  # stream-json transcripts: the summary is last
        data = next((d for d in reversed(data) if isinstance(d, dict)), {})
    if not isinstance(data, dict):
        return {}

    def pick(*names):
        for n in names:
            if data.get(n) is not None:
                return data[n]
        return None

    ms = pick("duration_ms", "durationMs")
    return {
        "cost_usd": pick("total_cost_usd", "cost_usd", "totalCostUsd"),
        "turns": pick("num_turns", "numTurns", "turns"),
        "duration_s": (ms / 1000.0) if isinstance(ms, (int, float)) else None,
        "is_error": bool(pick("is_error", "isError") or False),
        "result": (pick("result", "text") or "")[:400],
    }


def run_one(profile: str, task_dir: Path, attempt: int, args) -> Result:
    task = task_dir.name
    prompt = (task_dir / "task.md").read_text().strip()
    workdir = Path(args.workdir) / f"{profile}__{task}__{attempt}"
    if workdir.exists():
        shutil.rmtree(workdir)
    workdir.parent.mkdir(parents=True, exist_ok=True)

    result = Result(profile=profile, task=task, attempt=attempt,
                    passed=False, workdir=str(workdir))

    try:
        prepare_workdir(task_dir, workdir)
    except (OSError, subprocess.CalledProcessError) as exc:
        result.error = f"workdir setup failed: {exc}"
        return result

    cmd = [
        args.cli, "-p", prompt,
        "--output-format", "json",
        "--permission-mode", "acceptEdits",
        "--max-turns", str(args.max_turns),
    ]
    if args.model:
        cmd += ["--model", args.model]

    if args.dry_run:
        print(f"  [dry-run] {' '.join(cmd[:4])} ... (cwd={workdir})")
        result.error = "dry-run"
        return result

    try:
        env = {**os.environ, **load_profile_env(profile)}
        started = time.monotonic()
        proc = subprocess.run(cmd, cwd=workdir, env=env, capture_output=True,
                              text=True, timeout=args.timeout)
        wall = time.monotonic() - started
    except FileNotFoundError:
        result.error = f"{args.cli!r} not found on PATH"
        return result
    except subprocess.TimeoutExpired:
        result.error = f"timed out after {args.timeout}s"
        return result

    metrics = parse_cli_json(proc.stdout)
    result.cost_usd = metrics.get("cost_usd")
    result.turns = metrics.get("turns")
    result.duration_s = metrics.get("duration_s") or round(wall, 1)
    result.extra = {"agent_said": metrics.get("result", ""),
                    "exit_code": proc.returncode}
    if proc.returncode != 0 and not metrics:
        result.error = (proc.stderr or proc.stdout)[-400:].strip()

    verify = subprocess.run(["bash", str(task_dir / "verify.sh"), str(workdir)],
                            capture_output=True, text=True, timeout=120)
    result.passed = verify.returncode == 0
    result.verify_output = (verify.stdout + verify.stderr).strip()[-400:]
    return result


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--profiles", nargs="+", default=["claude", "deepseek", "glm"])
    ap.add_argument("--tasks", nargs="+", default=None)
    ap.add_argument("--repeat", type=int, default=1,
                    help="runs per profile/task; >1 exposes run-to-run variance")
    ap.add_argument("--max-turns", type=int, default=40)
    ap.add_argument("--timeout", type=int, default=900)
    ap.add_argument("--model", default=None,
                    help="passed to --model; omit to use the profile's aliases")
    ap.add_argument("--cli", default="claude")
    ap.add_argument("--workdir", default="/tmp/parity-runs")
    ap.add_argument("--out", default=str(HERE / "results.json"))
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)

    names = args.tasks or sorted(d.name for d in TASKS_DIR.iterdir()
                                 if (d / "task.md").exists())
    task_dirs = [TASKS_DIR / n for n in names]
    for td in task_dirs:
        if not (td / "verify.sh").exists():
            raise SystemExit(f"task {td.name} has no verify.sh")

    results: list[Result] = []
    for profile in args.profiles:
        if not args.dry_run:
            load_profile_env(profile)  # fail fast on a missing key
        for task_dir in task_dirs:
            for attempt in range(1, args.repeat + 1):
                label = f"{profile:9} {task_dir.name:26} #{attempt}"
                print(f"running {label}", flush=True)
                r = run_one(profile, task_dir, attempt, args)
                results.append(r)
                mark = "PASS" if r.passed else "fail"
                cost = f" ${r.cost_usd:.4f}" if r.cost_usd else ""
                note = f" ({r.error})" if r.error else ""
                print(f"   -> {mark}{cost}{note}", flush=True)

    Path(args.out).write_text(
        json.dumps([asdict(r) for r in results], indent=2) + "\n")
    print(f"\nwrote {args.out}  ({len(results)} runs)")
    print(f"summarise with:  python {HERE / 'report.py'} {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
