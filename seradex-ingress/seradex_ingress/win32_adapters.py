"""Win32 fact-gathering for the guards. Windows-only; nothing here decides anything.

Kept as thin as it can be on purpose: this is the one module that cannot be
exercised off the runner, so every line of judgement belongs in `guards` and
every line here belongs to ctypes.
"""

from __future__ import annotations

import ctypes
import platform
import time
from ctypes import wintypes
from typing import Any

from .geometry import Point, Rect
from .guards import FrameStats, SessionFacts, WindowFacts

_IS_WINDOWS = platform.system() == "Windows"


class PlatformUnavailable(RuntimeError):
    """Raised when a Win32 adapter is called off Windows."""


def _require_windows() -> None:
    if not _IS_WINDOWS:
        raise PlatformUnavailable(
            "win32_adapters requires Windows; run the driver on the dedicated runner"
        )


# WTS_CONNECTSTATE_CLASS
_WTS_STATES = {
    0: "active", 1: "connected", 2: "connectquery", 3: "shadow", 4: "disconnected",
    5: "idle", 6: "listen", 7: "reset", 8: "down", 9: "init",
}
_WTS_CURRENT_SERVER_HANDLE = 0
_WTS_CONNECT_STATE = 14
_UOI_NAME = 2
_DESKTOP_SWITCHDESKTOP = 0x0100


class _LASTINPUTINFO(ctypes.Structure):
    _fields_ = [("cbSize", wintypes.UINT), ("dwTime", wintypes.DWORD)]


def idle_seconds() -> float:
    """Seconds since the last input of any kind in this session.

    Note this counts the driver's own SendInput calls — see
    `guards.human_input_detected` for why that matters and how it is handled.
    """
    _require_windows()
    info = _LASTINPUTINFO()
    info.cbSize = ctypes.sizeof(_LASTINPUTINFO)
    if not ctypes.windll.user32.GetLastInputInfo(ctypes.byref(info)):
        raise ctypes.WinError(ctypes.get_last_error())
    # GetTickCount wraps every ~49.7 days; the unsigned subtraction is correct
    # across the wrap, which a naive signed one would not be.
    elapsed_ms = (ctypes.windll.kernel32.GetTickCount() - info.dwTime) & 0xFFFFFFFF
    return elapsed_ms / 1000.0


def current_session_id() -> int:
    _require_windows()
    sid = wintypes.DWORD()
    pid = ctypes.windll.kernel32.GetCurrentProcessId()
    if not ctypes.windll.kernel32.ProcessIdToSessionId(pid, ctypes.byref(sid)):
        raise ctypes.WinError(ctypes.get_last_error())
    return int(sid.value)


def connection_state(session_id: int) -> str:
    """WTS connection state for a session, lower-cased ('active', 'disconnected', ...)."""
    _require_windows()
    buf = ctypes.c_void_p()
    size = wintypes.DWORD()
    ok = ctypes.windll.wtsapi32.WTSQuerySessionInformationW(
        _WTS_CURRENT_SERVER_HANDLE, session_id, _WTS_CONNECT_STATE,
        ctypes.byref(buf), ctypes.byref(size),
    )
    if not ok:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        value = ctypes.cast(buf, ctypes.POINTER(ctypes.c_int)).contents.value
    finally:
        ctypes.windll.wtsapi32.WTSFreeMemory(buf)
    return _WTS_STATES.get(int(value), f"unknown({value})")


def session_locked() -> bool:
    """True when the lock screen owns the input desktop.

    Detected by name: the interactive desktop is 'Default' when a user is
    working and 'Winlogon' when the session is locked. If the input desktop
    cannot be opened at all, treat that as locked rather than as fine — the
    failure mode of guessing wrong here is typing into a lock screen.
    """
    _require_windows()
    hdesk = ctypes.windll.user32.OpenInputDesktop(0, False, _DESKTOP_SWITCHDESKTOP)
    if not hdesk:
        return True
    try:
        needed = wintypes.DWORD()
        buf = ctypes.create_unicode_buffer(256)
        ok = ctypes.windll.user32.GetUserObjectInformationW(
            hdesk, _UOI_NAME, buf, ctypes.sizeof(buf), ctypes.byref(needed)
        )
        if not ok:
            return True
        return buf.value.lower() != "default"
    finally:
        ctypes.windll.user32.CloseDesktop(hdesk)


def session_facts(last_injection_monotonic: float | None = None) -> SessionFacts:
    """Gather everything `guards.check_session` needs.

    `last_injection_monotonic` is the `time.monotonic()` stamp of this driver's
    most recent SendInput burst. Pass it — without it the human-presence check
    degrades to a cold idle floor and cannot tell the driver from a person.
    """
    _require_windows()
    sid = current_session_id()
    since_self = (
        None if last_injection_monotonic is None
        else max(0.0, time.monotonic() - last_injection_monotonic)
    )
    return SessionFacts(
        hostname=platform.node(),
        session_id=sid,
        connection_state=connection_state(sid),
        idle_seconds=idle_seconds(),
        seconds_since_self_injection=since_self,
        locked=session_locked(),
    )


def foreground_window_facts() -> WindowFacts:
    """Identity and geometry of whatever currently owns keyboard focus."""
    _require_windows()
    user32 = ctypes.windll.user32
    hwnd = user32.GetForegroundWindow()
    if not hwnd:
        # No foreground window at all: the session is locked, switching desktops,
        # or nothing is running. Report it as an unmatched window rather than
        # raising, so the guard can fold it into one combined refusal.
        return WindowFacts(
            hwnd=0, title="", class_name="", pid=0,
            rect=Rect(0, 0, 0, 0), is_minimized=True, is_visible=False,
        )

    length = user32.GetWindowTextLengthW(hwnd)
    title_buf = ctypes.create_unicode_buffer(length + 1)
    user32.GetWindowTextW(hwnd, title_buf, length + 1)

    class_buf = ctypes.create_unicode_buffer(256)
    user32.GetClassNameW(hwnd, class_buf, 256)

    pid = wintypes.DWORD()
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))

    rect = wintypes.RECT()
    if not user32.GetWindowRect(hwnd, ctypes.byref(rect)):
        raise ctypes.WinError(ctypes.get_last_error())

    return WindowFacts(
        hwnd=int(hwnd),
        title=title_buf.value,
        class_name=class_buf.value,
        pid=int(pid.value),
        rect=Rect(float(rect.left), float(rect.top), float(rect.right), float(rect.bottom)),
        is_minimized=bool(user32.IsIconic(hwnd)),
        is_visible=bool(user32.IsWindowVisible(hwnd)),
    )


def frame_stats(image: Any) -> FrameStats:
    """Luminance statistics for the blank-frame guard."""
    from PIL import ImageStat  # lazy: PIL lives on the runner, not the dev box

    grey = image.convert("L")
    stat = ImageStat.Stat(grey)
    return FrameStats(
        width=image.width,
        height=image.height,
        mean_luma=float(stat.mean[0]),
        stddev_luma=float(stat.stddev[0]),
    )


def grab(bbox: tuple[int, int, int, int] | None = None) -> Any:
    """Screenshot, spanning every monitor.

    `all_screens=True` matters on the runner as much as on a workstation: a
    RemoteApp window placed on a secondary monitor is simply absent from the
    default primary-only grab, and the failure looks exactly like OCR failing
    to find the form.
    """
    from PIL import ImageGrab  # lazy, as above

    return ImageGrab.grab(bbox=bbox, all_screens=True)
