import pytest

from seradex_ingress.geometry import Point, Rect
from seradex_ingress.guards import (
    FramePolicy,
    FrameStats,
    GuardResult,
    GuardViolation,
    SessionFacts,
    SessionPolicy,
    WindowFacts,
    WindowPolicy,
    check_frame,
    check_session,
    check_window,
    combine,
    human_input_detected,
    preflight,
)

RUNNER = SessionPolicy(allowed_hostnames=("AP-BOT-01",))


def session(**kw) -> SessionFacts:
    base = dict(
        hostname="AP-BOT-01",
        session_id=3,
        connection_state="active",
        idle_seconds=30.0,
        seconds_since_self_injection=30.0,
        locked=False,
    )
    base.update(kw)
    return SessionFacts(**base)


def window(**kw) -> WindowFacts:
    base = dict(
        hwnd=1234,
        title="Financials - Talius - New SQL Server - Vendor Invoicing",
        class_name="WindowsForms10.Window.8.app.0.141b42a_r6_ad1",
        pid=4242,
        rect=Rect(100, 100, 1300, 900),
        is_minimized=False,
        is_visible=True,
    )
    base.update(kw)
    return WindowFacts(**base)


FORM = WindowPolicy(title_pattern=r"Vendor Invoicing")
LIVE_FRAME = FrameStats(width=1920, height=1080, mean_luma=190.0, stddev_luma=58.0)


# --- session ---------------------------------------------------------------

def test_healthy_runner_session_passes():
    assert check_session(session(), RUNNER).ok


def test_refuses_to_run_on_a_workstation_that_is_not_a_designated_runner():
    """The whole point of the isolated runner: never hijack a real desktop."""
    result = check_session(session(hostname="ANTONIO-LAPTOP"), RUNNER)

    assert not result.ok
    assert any("not a designated runner" in r for r in result.reasons)


def test_refuses_when_no_runner_is_configured_at_all():
    """An unset allowlist must fail closed, not open."""
    result = check_session(session(), SessionPolicy())

    assert not result.ok
    assert any("no allowed_hostnames" in r for r in result.reasons)


def test_hostname_match_is_case_insensitive():
    assert check_session(session(hostname="ap-bot-01"), RUNNER).ok


def test_refuses_a_disconnected_session_because_capture_would_be_blank():
    result = check_session(session(connection_state="disconnected"), RUNNER)

    assert not result.ok
    assert any("not active" in r for r in result.reasons)


def test_refuses_a_locked_session():
    assert not check_session(session(locked=True), RUNNER).ok


# --- the human-presence subtlety -------------------------------------------

def test_the_drivers_own_typing_is_not_mistaken_for_a_human():
    """SendInput resets the idle timer too, so idle==self-injection means 'only us'."""
    facts = session(idle_seconds=0.2, seconds_since_self_injection=0.2)

    assert not human_input_detected(facts, RUNNER)
    assert check_session(facts, RUNNER).ok


def test_a_human_typing_after_the_driver_is_detected():
    """Idle time below time-since-our-last-burst can only mean someone else typed."""
    facts = session(idle_seconds=0.5, seconds_since_self_injection=20.0)

    assert human_input_detected(facts, RUNNER)
    result = check_session(facts, RUNNER)
    assert not result.ok
    assert any("someone other than this driver" in r for r in result.reasons)


def test_cold_start_falls_back_to_an_idle_floor():
    """Before the first burst there is no self-timestamp to compare against."""
    assert human_input_detected(session(idle_seconds=1.0, seconds_since_self_injection=None), RUNNER)
    assert not human_input_detected(session(idle_seconds=9.0, seconds_since_self_injection=None), RUNNER)


def test_clock_jitter_inside_the_tolerance_is_not_a_human():
    facts = session(idle_seconds=4.6, seconds_since_self_injection=5.0)

    assert not human_input_detected(facts, RUNNER)


# --- frame -----------------------------------------------------------------

def test_live_frame_passes():
    assert check_frame(LIVE_FRAME).ok


def test_black_frame_from_a_minimised_rdp_session_is_caught():
    """The failure that makes OCR verification pass on nothing at all."""
    result = check_frame(FrameStats(1920, 1080, mean_luma=0.0, stddev_luma=0.0))

    assert not result.ok
    assert any("near-uniform" in r for r in result.reasons)


def test_solid_white_frame_is_caught_too():
    assert not check_frame(FrameStats(1920, 1080, 255.0, 0.4)).ok


def test_undersized_frame_is_caught():
    result = check_frame(FrameStats(64, 64, 128.0, 40.0))

    assert not result.ok
    assert any("smaller than" in r for r in result.reasons)


# --- window ----------------------------------------------------------------

def test_correct_foreground_window_passes():
    targets = [Point(200, 200), Point(1200, 800)]

    assert check_window(window(), FORM, targets).ok


def test_wrong_foreground_window_is_refused():
    """Blind keybd_event's failure mode: focus moved, keys follow it."""
    result = check_window(window(title="Inbox - Antonio Clair - Outlook"), FORM)

    assert not result.ok
    assert any("does not match" in r for r in result.reasons)


def test_targets_outside_the_window_are_refused():
    """Stale coordinates after a window move land on whatever is underneath."""
    result = check_window(window(), FORM, [Point(200, 200), Point(1800, 1000)])

    assert not result.ok
    assert any("outside the window" in r for r in result.reasons)


def test_edge_margin_keeps_clicks_off_the_frame_border():
    edge = Point(100, 500)

    assert check_window(window(), WindowPolicy(FORM.title_pattern, edge_margin_px=0.0), [edge]).ok
    assert not check_window(window(), FORM, [edge]).ok


def test_minimized_window_is_refused():
    assert not check_window(window(is_minimized=True), FORM).ok


def test_no_foreground_window_at_all_is_refused():
    """What win32_adapters reports when GetForegroundWindow returns NULL."""
    nothing = WindowFacts(0, "", "", 0, Rect(0, 0, 0, 0), is_minimized=True, is_visible=False)

    assert not check_window(nothing, FORM).ok


def test_class_allowlist_rejects_a_lookalike_title():
    policy = WindowPolicy(title_pattern=r"Vendor Invoicing", class_allowlist=("WindowsForms10.Window.8.app.0.141b42a_r6_ad1",))

    assert check_window(window(), policy).ok
    assert not check_window(window(class_name="Chrome_WidgetWin_1"), policy).ok


def test_invalid_title_pattern_fails_closed():
    result = check_window(window(), WindowPolicy(title_pattern="Vendor ((("))

    assert not result.ok
    assert any("invalid title_pattern" in r for r in result.reasons)


# --- composition -----------------------------------------------------------

def test_preflight_reports_every_failure_at_once():
    result = preflight(
        session(hostname="ANTONIO-LAPTOP", connection_state="disconnected"),
        RUNNER,
        FrameStats(1920, 1080, 0.0, 0.0),
        window(title="Outlook"),
        FORM,
        [Point(5000, 5000)],
    )

    assert not result.ok
    assert len(result.reasons) >= 4


def test_preflight_passes_when_everything_is_right():
    assert preflight(session(), RUNNER, LIVE_FRAME, window(), FORM, [Point(200, 200)]).ok


def test_guard_result_require_raises_with_all_reasons():
    with pytest.raises(GuardViolation, match="not a designated runner"):
        check_session(session(hostname="OTHER"), RUNNER).require("input")


def test_combine_is_truthy_only_when_empty_of_reasons():
    assert combine(GuardResult.passed(), GuardResult.passed()).ok
    assert not combine(GuardResult.passed(), GuardResult.failed("nope")).ok
    assert bool(GuardResult.passed()) is True
