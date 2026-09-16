import pytest

from seradex_ingress.geometry import Point, Rect, Similarity
from seradex_ingress.ocr import TextLine
from seradex_ingress.registration import (
    Landmark,
    RegistrationError,
    RegistrationPolicy,
    match_landmarks,
    normalize,
    register,
    similarity_ratio,
)

# A stand-in for the Vendor Invoicing form as captured at calibration time.
REFERENCE = [
    Landmark("title", "Vendor Invoicing", Point(120, 40), required=True),
    Landmark("po", "PO Number", Point(140, 180)),
    Landmark("invoice_no", "Invoice Number", Point(140, 220)),
    Landmark("invoice_date", "Invoice Date", Point(140, 260)),
    Landmark("total", "Total", Point(140, 320)),
]


def line(text: str, at: Point, w: float = 90, h: float = 14) -> TextLine:
    """A TextLine whose .anchor lands exactly on `at`."""
    return TextLine(text, Rect(at.x, at.y - h / 2, at.x + w, at.y + h / 2), 95.0)


def frame(transform: Similarity, landmarks=REFERENCE, extra=()) -> list[TextLine]:
    lines = [line(lm.text, transform.apply(lm.point)) for lm in landmarks]
    lines.extend(extra)
    return lines


def test_normalize_folds_case_punctuation_and_ocr_confusions():
    assert normalize("Invoice Date:") == normalize("invoicedate")
    assert normalize("PO Number") == normalize("P0 Number")
    assert normalize("Total") == normalize("T0tal")


def test_similarity_ratio_is_symmetric_and_bounded():
    assert similarity_ratio("Total", "Total") == 1.0
    assert similarity_ratio("Total", "") == 0.0
    assert 0.0 < similarity_ratio("Invoice Date", "Invoce Date") < 1.0


def test_registers_a_window_that_simply_moved():
    truth = Similarity(1.0, 220.0, -95.0)

    reg = register(REFERENCE, frame(truth))

    assert reg.ok, reg.reasons
    assert reg.transform.dx == pytest.approx(220.0, abs=0.5)
    assert reg.transform.dy == pytest.approx(-95.0, abs=0.5)
    assert reg.rms_error < 1.0
    assert len(reg.matched) == 5


def test_survives_ocr_typos_in_the_labels():
    truth = Similarity(1.0, 10.0, 10.0)
    lines = [
        line("Vendor lnvoicing", truth.apply(REFERENCE[0].point)),
        line("P0 Number", truth.apply(REFERENCE[1].point)),
        line("lnvoice Number", truth.apply(REFERENCE[2].point)),
        line("Invoice Date", truth.apply(REFERENCE[3].point)),
        line("T0tal", truth.apply(REFERENCE[4].point)),
    ]

    reg = register(REFERENCE, lines)

    assert reg.ok, reg.reasons
    assert reg.transform.dx == pytest.approx(10.0, abs=0.5)


def test_duplicate_label_text_resolves_by_position_not_by_score():
    """Two 'Total's on the form: the fit must pick the one it calibrated against."""
    truth = Similarity(1.0, 40.0, 30.0)
    lines = frame(truth, extra=[line("Total", Point(700, 900))])

    reg = register(REFERENCE, lines)

    assert reg.ok, reg.reasons
    total = next(c for c in reg.matched if c.landmark.name == "total")
    assert total.line.anchor.distance_to(truth.apply(REFERENCE[4].point)) < 1.0


def test_refuses_when_too_few_landmarks_are_visible():
    """A partially-occluded form must not be typed into on two matches."""
    truth = Similarity(1.0, 5.0, 5.0)
    lines = frame(truth, landmarks=REFERENCE[:2])

    reg = register(REFERENCE, lines)

    assert not reg.ok
    assert any("need 3" in r for r in reg.reasons)
    assert set(reg.unmatched) == {"invoice_no", "invoice_date", "total"}


def test_refuses_when_the_required_landmark_is_absent():
    """Four fields match, but this is the Sales Order screen, not Vendor Invoicing."""
    truth = Similarity(1.0, 5.0, 5.0)
    lines = frame(truth, landmarks=REFERENCE[1:])

    reg = register(REFERENCE, lines)

    assert not reg.ok
    assert any("required landmark" in r and "title" in r for r in reg.reasons)


def test_refuses_a_frame_with_no_text_at_all():
    reg = register(REFERENCE, [])

    assert not reg.ok
    assert reg.transform == Similarity.IDENTITY
    with pytest.raises(RegistrationError):
        reg.require()


def test_refuses_when_landmarks_do_not_agree_on_one_transform():
    """Labels found, but scattered - two forms open, or a stale composite frame."""
    lines = [
        line("Vendor Invoicing", Point(120, 40)),
        line("PO Number", Point(140, 180)),
        line("Invoice Number", Point(900, 640)),
        line("Invoice Date", Point(140, 260)),
        line("Total", Point(1500, 90)),
    ]

    reg = register(REFERENCE, lines, RegistrationPolicy(max_rms_px=6.0))

    assert not reg.ok
    assert any("disagreed with the consensus" in r for r in reg.reasons)


def test_tolerates_sub_pixel_ocr_jitter():
    truth = Similarity(1.0, 77.0, 33.0)
    jitter = [(1.0, -1.0), (-1.0, 1.0), (0.0, 1.0), (1.0, 0.0), (-1.0, -1.0)]
    lines = [
        line(lm.text, Point(truth.apply(lm.point).x + dx, truth.apply(lm.point).y + dy))
        for lm, (dx, dy) in zip(REFERENCE, jitter)
    ]

    reg = register(REFERENCE, lines)

    assert reg.ok, reg.reasons
    assert reg.rms_error < 2.0


def test_match_landmarks_returns_nothing_without_a_seed():
    assert match_landmarks(REFERENCE, [line("Completely Unrelated", Point(0, 0))]) == []


# --- landmark proposal ------------------------------------------------------

from seradex_ingress.registration import propose_landmarks  # noqa: E402


def test_proposal_drops_labels_that_appear_twice():
    """A repeated label cannot establish position; it can only be placed by it."""
    lines = [
        line("Vendor Invoicing", Point(100, 40)),
        line("Date", Point(100, 200)),
        line("Date", Point(600, 200)),
        line("PO Number", Point(100, 400)),
        line("Total", Point(600, 400)),
    ]

    names = {p.landmark.text for p in propose_landmarks(lines, count=6)}

    assert "Date" not in names
    assert names == {"Vendor Invoicing", "PO Number", "Total"}


def test_proposal_spreads_across_the_form_rather_than_clustering():
    clustered = [line(f"Field {i}", Point(100 + i, 100 + i)) for i in range(6)]
    corners = [
        line("Top Right Label", Point(900, 100)),
        line("Bottom Left Label", Point(100, 700)),
        line("Bottom Right Label", Point(900, 700)),
    ]

    picked = propose_landmarks(clustered + corners, count=4)
    texts = {p.landmark.text for p in picked}

    assert {"Top Right Label", "Bottom Left Label", "Bottom Right Label"} <= texts


def test_proposal_honours_confidence_and_length_floors():
    lines = [
        line("Vendor Invoicing", Point(100, 40)),
        TextLine("ok", Rect(100, 200, 120, 214), 99.0),
        TextLine("Smudged Label", Rect(100, 300, 200, 314), 41.0),
    ]

    picked = propose_landmarks(lines, count=6)

    assert [p.landmark.text for p in picked] == ["Vendor Invoicing"]


def test_proposal_ignores_text_outside_the_form_window():
    lines = [
        line("Vendor Invoicing", Point(200, 200)),
        line("PO Number", Point(240, 300)),
        line("Recycle Bin", Point(20, 20)),
    ]

    picked = propose_landmarks(lines, count=6, region=Rect(100, 100, 1300, 900))

    assert "Recycle Bin" not in {p.landmark.text for p in picked}


def test_proposed_landmarks_round_trip_into_a_working_registration():
    """The captured set must be usable by the thing that consumes it."""
    lines = [
        line("Vendor Invoicing", Point(120, 140)),
        line("PO Number", Point(140, 180)),
        line("Invoice Number", Point(140, 220)),
        line("Invoice Date", Point(140, 260)),
        line("Grand Total", Point(900, 700)),
    ]
    proposed = [p.landmark for p in propose_landmarks(lines, count=5)]

    moved = Similarity(1.0, 333.0, -77.0)
    reg = register(proposed, [line(lm.text, moved.apply(lm.point)) for lm in proposed])

    assert reg.ok, reg.reasons
    assert reg.transform.dx == pytest.approx(333.0, abs=0.5)


def test_proposal_on_an_empty_frame_returns_nothing():
    assert propose_landmarks([]) == []
