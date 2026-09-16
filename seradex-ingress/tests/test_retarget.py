import json

import pytest

from seradex_ingress.calibration import (
    Anchor,
    CalibrationError,
    CalibrationProfile,
    max_disagreement,
    transform_from_window,
)
from seradex_ingress.geometry import Point, Rect, Similarity
from seradex_ingress.ocr import TextLine
from seradex_ingress.registration import Landmark, RegistrationPolicy
from seradex_ingress.retarget import (
    RetargetError,
    RetargetPolicy,
    describe,
    retarget,
    search_region,
)

PROFILE = CalibrationProfile(
    screen="vendor_invoicing",
    window_title_pattern=r"Vendor Invoicing",
    reference_window=Rect(100, 100, 1300, 900),
    anchors=(
        Anchor("po_field", Point(320, 180), kind="field"),
        Anchor("invoice_date_mm", Point(320, 260), kind="field"),
        Anchor("invoice_date_dd", Point(352, 260), kind="field"),
        Anchor("invoice_date_yyyy", Point(384, 260), kind="field"),
        Anchor("save_button", Point(1180, 840), kind="button"),
    ),
    landmarks=(
        Landmark("title", "Vendor Invoicing", Point(120, 140), required=True),
        Landmark("po", "PO Number", Point(140, 180)),
        Landmark("invoice_no", "Invoice Number", Point(140, 220)),
        Landmark("invoice_date", "Invoice Date", Point(140, 260)),
        Landmark("total", "Total", Point(140, 320)),
    ),
    seradex_version="6.4.145",
)


def line(text: str, at: Point, w: float = 90, h: float = 14) -> TextLine:
    return TextLine(text, Rect(at.x, at.y - h / 2, at.x + w, at.y + h / 2), 95.0)


def frame(transform: Similarity) -> list[TextLine]:
    return [line(lm.text, transform.apply(lm.point)) for lm in PROFILE.landmarks]


def moved_window(transform: Similarity) -> Rect:
    return transform.apply_rect(PROFILE.reference_window)


def test_anchors_follow_the_form_when_the_window_moves():
    truth = Similarity(1.0, 400.0, -60.0)

    result = retarget(PROFILE, frame(truth), window_rect=moved_window(truth))

    assert result.ok, result.reasons
    targets = result.require()
    assert targets.click_point("po_field") == (720, 120)
    assert targets.click_point("save_button") == (1580, 780)


def test_segmented_date_boxes_keep_their_spacing():
    """The mm/dd/yyyy boxes are ~32px apart; a fit that smears them is useless."""
    truth = Similarity(1.0, 250.0, 250.0)

    targets = retarget(PROFILE, frame(truth), window_rect=moved_window(truth)).require()

    mm = targets["invoice_date_mm"]
    dd = targets["invoice_date_dd"]
    yyyy = targets["invoice_date_yyyy"]
    assert dd.x - mm.x == pytest.approx(32.0, abs=0.5)
    assert yyyy.x - dd.x == pytest.approx(32.0, abs=0.5)
    assert mm.y == dd.y == yyyy.y


def test_display_scaling_is_absorbed():
    truth = Similarity(1.05, 30.0, 12.0)

    result = retarget(PROFILE, frame(truth), window_rect=moved_window(truth))

    assert result.ok, result.reasons
    assert result.targets.transform.scale == pytest.approx(1.05, abs=0.01)
    expected = truth.apply(PROFILE.anchor("save_button").point)
    assert result.targets["save_button"].distance_to(expected) < 2.0


def test_ocr_and_window_geometry_must_agree():
    """A second copy of the form: OCR locks onto one, the window handle is the other."""
    ocr_truth = Similarity(1.0, 400.0, -60.0)
    stale_window = Rect(100, 100, 1300, 900)  # handle still points at the old position

    result = retarget(PROFILE, frame(ocr_truth), window_rect=stale_window)

    assert not result.ok
    assert result.disagreement_px == pytest.approx(404.5, abs=1.0)
    assert any("disagree" in r for r in result.reasons)


def test_cross_check_is_required_by_default_and_says_so():
    truth = Similarity(1.0, 10.0, 10.0)

    result = retarget(PROFILE, frame(truth))

    assert not result.ok
    assert any("no current window rect" in r for r in result.reasons)


def test_cross_check_can_be_disabled_deliberately():
    truth = Similarity(1.0, 10.0, 10.0)
    policy = RetargetPolicy(require_window_crosscheck=False)

    assert retarget(PROFILE, frame(truth), policy=policy).ok


def test_failed_registration_yields_no_coordinates_at_all():
    """There is no partial answer: reasons, or targets, never both."""
    result = retarget(PROFILE, [line("Sales Order Entry", Point(100, 100))])

    assert not result.ok
    assert result.targets is None
    with pytest.raises(RetargetError):
        result.require()


def test_describe_summarises_both_outcomes():
    truth = Similarity(1.0, 20.0, 20.0)

    ok = describe(retarget(PROFILE, frame(truth), window_rect=moved_window(truth)))
    bad = describe(retarget(PROFILE, []))

    assert ok.startswith("RETARGET ok") and "landmarks=5" in ok and "crosscheck=" in ok
    assert bad.startswith("RETARGET FAILED")


def test_search_region_pads_the_window():
    assert search_region(Rect(100, 200, 500, 600), pad=10) == (90, 190, 510, 610)


# --- profile round-tripping -------------------------------------------------

def test_profile_survives_a_json_round_trip(tmp_path):
    path = tmp_path / "vendor_invoicing.json"
    PROFILE.save(path)

    loaded = CalibrationProfile.load(path)

    assert loaded.anchor_names == PROFILE.anchor_names
    assert loaded.anchor("save_button").point == PROFILE.anchor("save_button").point
    assert loaded.landmarks == PROFILE.landmarks
    assert loaded.reference_window == PROFILE.reference_window
    assert json.loads(path.read_text())["captured_utc"]


def test_profile_with_duplicate_anchor_names_is_rejected():
    data = PROFILE.to_dict()
    data["anchors"].append(dict(data["anchors"][0]))

    with pytest.raises(CalibrationError, match="duplicate anchor"):
        CalibrationProfile.from_dict(data)


def test_profile_missing_a_required_key_is_rejected():
    data = PROFILE.to_dict()
    del data["landmarks"]

    with pytest.raises(CalibrationError, match="landmarks"):
        CalibrationProfile.from_dict(data)


def test_malformed_point_names_the_offending_anchor():
    data = PROFILE.to_dict()
    data["anchors"][1]["point"] = {"x": "left-ish"}

    with pytest.raises(CalibrationError, match="invoice_date_mm"):
        CalibrationProfile.from_dict(data)


def test_unknown_anchor_lookup_is_explicit():
    targets = retarget(
        PROFILE,
        frame(Similarity(1.0, 0.0, 0.0)),
        window_rect=PROFILE.reference_window,
    ).require()

    with pytest.raises(KeyError, match="approve_button"):
        targets["approve_button"]


# --- the second estimator ---------------------------------------------------

def test_window_transform_recovers_a_move():
    t = transform_from_window(Rect(0, 0, 100, 100), Rect(50, 70, 150, 170))

    assert t.scale == pytest.approx(1.0)
    assert (t.dx, t.dy) == pytest.approx((50.0, 70.0))


def test_window_transform_recovers_a_resize():
    t = transform_from_window(Rect(0, 0, 100, 100), Rect(0, 0, 150, 150))

    assert t.scale == pytest.approx(1.5)


def test_window_transform_rejects_a_degenerate_rect():
    with pytest.raises(CalibrationError):
        transform_from_window(Rect(0, 0, 0, 0), Rect(0, 0, 10, 10))


def test_disagreement_is_measured_where_the_anchors_are():
    """A small scale error is invisible at the origin and large at the Save button."""
    a = Similarity(1.0, 0.0, 0.0)
    b = Similarity(1.01, 0.0, 0.0)

    assert max_disagreement(a, b, [Point(0, 0)]) == pytest.approx(0.0)
    assert max_disagreement(a, b, [Point(0, 0), Point(1180, 840)]) > 14.0
