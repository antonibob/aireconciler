"""Preflight checks that stand between a parsed invoice and a keystroke.

Every guard here exists because of a specific way this can go wrong on a live
accounting form:

  * `check_session`  - the driver is running on the human's own desktop, so
                       SendInput steals their mouse; or a human has walked into
                       the bot's session and is typing right now.
  * `check_frame`    - the RDP session is disconnected or minimised, so the
                       screenshot is black and OCR verification silently passes
                       on nothing.
  * `check_window`   - the foreground window is not Vendor Invoicing, so the
                       keystrokes land in whatever is.

All three take plain facts and return a verdict. The Win32 calls that gather
those facts live in `win32_adapters`, so the decisions stay testable.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable, Sequence

from .geometry import Point, Rect


class GuardViolation(RuntimeError):
    """Raised when a preflight check refuses to let input proceed."""


@dataclass(frozen=True)
class GuardResult:
    ok: bool
    reasons: tuple[str, ...] = ()

    def __bool__(self) -> bool:
        return self.ok

    def require(self, what: str = "preflight") -> None:
        if not self.ok:
            raise GuardViolation(f"{what} refused: " + "; ".join(self.reasons))

    @staticmethod
    def passed() -> "GuardResult":
        return GuardResult(True, ())

    @staticmethod
    def failed(*reasons: str) -> "GuardResult":
        return GuardResult(False, tuple(reasons))


def combine(*results: GuardResult) -> GuardResult:
    reasons: list[str] = []
    for r in results:
        reasons.extend(r.reasons)
    return GuardResult(ok=not reasons, reasons=tuple(reasons))


# --------------------------------------------------------------------------
# Session
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class SessionFacts:
    hostname: str
    session_id: int
    connection_state: str
    """WTS connection state, lower-cased: 'active', 'disconnected', 'shadow', ..."""
    idle_seconds: float
    """Seconds since the last input *of any kind* in this session (GetLastInputInfo)."""
    seconds_since_self_injection: float | None = None
    """Seconds since this driver last injected input, or None if it never has."""
    locked: bool = False


@dataclass(frozen=True)
class SessionPolicy:
    allowed_hostnames: tuple[str, ...] = ()
    """The dedicated runner host(s). Empty means 'refuse to run anywhere'."""
    require_active: bool = True
    human_idle_tolerance_s: float = 0.75
    min_idle_seconds_cold: float = 5.0
    """Idle floor before the first injection of a run, when there is no self-timestamp."""


def human_input_detected(facts: SessionFacts, policy: SessionPolicy) -> bool:
    """Decide whether someone other than this driver is using the session.

    The subtlety that makes a naive idle check useless: SendInput resets
    GetLastInputInfo too. So after the driver types, idle time measures *the
    driver*, and a plain `idle < threshold` test fires on the bot's own work.

    If nobody but the driver has touched the session, idle time equals the time
    since the driver's own last injection. A human typing after us can only make
    idle time *smaller* than that. So the real signal is the gap between the
    two, not the idle time alone.
    """
    if facts.seconds_since_self_injection is None:
        return facts.idle_seconds < policy.min_idle_seconds_cold
    return facts.idle_seconds < facts.seconds_since_self_injection - policy.human_idle_tolerance_s


def check_session(facts: SessionFacts, policy: SessionPolicy) -> GuardResult:
    reasons: list[str] = []

    allowed = {h.strip().lower() for h in policy.allowed_hostnames if h.strip()}
    host = facts.hostname.strip().lower()
    if not allowed:
        reasons.append(
            "no allowed_hostnames configured; refusing to inject input anywhere"
        )
    elif host not in allowed:
        reasons.append(
            f"host {facts.hostname!r} is not a designated runner "
            f"({', '.join(sorted(allowed))}) - input here would hijack a real desktop"
        )

    if policy.require_active and facts.connection_state != "active":
        reasons.append(
            f"session {facts.session_id} is {facts.connection_state!r}, not active; "
            "screen capture would be blank"
        )

    if facts.locked:
        reasons.append(f"session {facts.session_id} is locked")

    if human_input_detected(facts, policy):
        reasons.append(
            "recent input from someone other than this driver; yielding the session"
        )

    return GuardResult(ok=not reasons, reasons=tuple(reasons))


# --------------------------------------------------------------------------
# Frame
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class FrameStats:
    width: int
    height: int
    mean_luma: float
    stddev_luma: float


@dataclass(frozen=True)
class FramePolicy:
    min_stddev: float = 3.0
    """A live Win32 form has strong contrast; a black or solid frame has none."""
    min_width: int = 320
    min_height: int = 240


def check_frame(stats: FrameStats, policy: FramePolicy = FramePolicy()) -> GuardResult:
    """Catch the black-screenshot failure before it becomes a false OCR pass.

    A minimised or disconnected RDP session stops composing a desktop, and
    `ImageGrab` then returns a uniform frame. OCR finds no text in it, the
    verification step finds no mismatch, and the invoice looks like it filed
    cleanly. This is the check that makes that impossible.
    """
    reasons: list[str] = []
    if stats.width < policy.min_width or stats.height < policy.min_height:
        reasons.append(
            f"frame {stats.width}x{stats.height} is smaller than "
            f"{policy.min_width}x{policy.min_height}"
        )
    if stats.stddev_luma < policy.min_stddev:
        reasons.append(
            f"frame is near-uniform (stddev {stats.stddev_luma:.2f}, "
            f"mean {stats.mean_luma:.1f}) - session is probably minimised or disconnected"
        )
    return GuardResult(ok=not reasons, reasons=tuple(reasons))


# --------------------------------------------------------------------------
# Window
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class WindowFacts:
    hwnd: int
    title: str
    class_name: str
    pid: int
    rect: Rect
    is_minimized: bool = False
    is_visible: bool = True


@dataclass(frozen=True)
class WindowPolicy:
    title_pattern: str
    class_allowlist: tuple[str, ...] = ()
    require_points_inside: bool = True
    edge_margin_px: float = 2.0


def check_window(
    window: WindowFacts,
    policy: WindowPolicy,
    targets: Iterable[Point] = (),
) -> GuardResult:
    """Prove the foreground window is the form before a single key is sent.

    This is the answer to blind `keybd_event`: input goes wherever focus is, so
    focus has to be *verified*, not assumed, on every burst — not once at start,
    because a toast, a lock screen, or a colleague's Teams call can take
    foreground between two fields of the same invoice.
    """
    reasons: list[str] = []

    try:
        pattern = re.compile(policy.title_pattern, re.IGNORECASE)
    except re.error as exc:
        return GuardResult.failed(f"invalid title_pattern {policy.title_pattern!r}: {exc}")

    if not pattern.search(window.title or ""):
        reasons.append(
            f"foreground window is {window.title!r}, "
            f"which does not match /{policy.title_pattern}/"
        )

    if policy.class_allowlist and window.class_name not in policy.class_allowlist:
        reasons.append(
            f"window class {window.class_name!r} is not in "
            f"({', '.join(policy.class_allowlist)})"
        )

    if window.is_minimized:
        reasons.append("target window is minimized")
    if not window.is_visible:
        reasons.append("target window is not visible")

    if policy.require_points_inside:
        outside = [
            p for p in targets if not window.rect.contains(p, margin=policy.edge_margin_px)
        ]
        if outside:
            sample = ", ".join(f"({p.x:.0f},{p.y:.0f})" for p in outside[:3])
            more = "" if len(outside) <= 3 else f" (+{len(outside) - 3} more)"
            reasons.append(
                f"{len(outside)} target point(s) fall outside the window: {sample}{more}"
            )

    return GuardResult(ok=not reasons, reasons=tuple(reasons))


def preflight(
    session: SessionFacts,
    session_policy: SessionPolicy,
    frame: FrameStats,
    window: WindowFacts,
    window_policy: WindowPolicy,
    targets: Sequence[Point] = (),
    frame_policy: FramePolicy = FramePolicy(),
) -> GuardResult:
    """Run every guard and report *all* failures, not just the first.

    Reporting them together matters during setup: a misconfigured runner
    typically trips several at once, and fixing them one round-trip at a time
    across an RDP session is its own afternoon.
    """
    return combine(
        check_session(session, session_policy),
        check_frame(frame, frame_policy),
        check_window(window, window_policy, targets),
    )
