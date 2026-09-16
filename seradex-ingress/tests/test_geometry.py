import math

import pytest

from seradex_ingress.geometry import (
    FitError,
    Point,
    Rect,
    Similarity,
    fit_robust,
    fit_similarity,
    fit_translation,
    residuals,
    rms,
)


def test_translation_recovers_a_pure_window_move():
    truth = Similarity(1.0, 137.0, -42.0)
    refs = [Point(10, 20), Point(300, 55), Point(140, 400)]
    pairs = [(p, truth.apply(p)) for p in refs]

    fit = fit_translation(pairs)

    assert fit.scale == 1.0
    assert fit.dx == pytest.approx(137.0)
    assert fit.dy == pytest.approx(-42.0)


def test_similarity_recovers_display_scaling():
    truth = Similarity(1.25, -60.0, 15.0)
    refs = [Point(0, 0), Point(400, 0), Point(400, 300), Point(0, 300)]
    pairs = [(p, truth.apply(p)) for p in refs]

    fit = fit_similarity(pairs)

    assert fit.scale == pytest.approx(1.25)
    assert fit.dx == pytest.approx(-60.0)
    assert fit.dy == pytest.approx(15.0)
    assert max(residuals(fit, pairs)) == pytest.approx(0.0, abs=1e-6)


def test_similarity_needs_two_distinct_points():
    with pytest.raises(FitError):
        fit_similarity([(Point(5, 5), Point(9, 9))])
    with pytest.raises(FitError, match="coincident"):
        fit_similarity([(Point(5, 5), Point(9, 9)), (Point(5, 5), Point(9, 10))])


def test_robust_fit_discards_a_mismatched_landmark():
    """One label matched to the wrong row must not drag the whole form sideways."""
    truth = Similarity(1.0, 50.0, 50.0)
    refs = [Point(10, 10), Point(200, 12), Point(205, 300), Point(12, 295)]
    pairs = [(p, truth.apply(p)) for p in refs]
    # The classic failure: "Date" matched to the second "Date" on the form.
    pairs.append((Point(150, 150), Point(150 + 50, 150 + 50 + 180)))

    fit = fit_robust(pairs)

    assert 4 not in fit.inliers, "the outlier should have been rejected"
    assert fit.transform.dx == pytest.approx(50.0, abs=0.5)
    assert fit.transform.dy == pytest.approx(50.0, abs=0.5)
    assert fit.rms_error < 1.0


def test_robust_fit_refuses_implausible_scale_and_falls_back_to_translation():
    """A bad correspondence can imply a 2x zoom. Real RDP scaling never does."""
    pairs = [
        (Point(0, 0), Point(100, 100)),
        (Point(100, 0), Point(400, 100)),
        (Point(0, 100), Point(100, 400)),
    ]

    fit = fit_robust(pairs, scale_bounds=(0.9, 1.1))

    assert fit.transform.scale == 1.0


def test_robust_fit_accepts_scale_within_bounds():
    truth = Similarity(1.05, 10.0, 20.0)
    refs = [Point(0, 0), Point(500, 0), Point(500, 400), Point(0, 400)]
    pairs = [(p, truth.apply(p)) for p in refs]

    fit = fit_robust(pairs, scale_bounds=(0.9, 1.1))

    assert fit.transform.scale == pytest.approx(1.05, abs=1e-6)


def test_rect_contains_respects_margin():
    r = Rect(0, 0, 100, 50)
    assert r.contains(Point(50, 25))
    assert r.contains(Point(0, 0))
    assert not r.contains(Point(0, 0), margin=1.0)
    assert not r.contains(Point(101, 25))


def test_point_rounds_to_integer_screen_coordinates():
    assert Point(10.4, 20.6).rounded() == (10, 21)
    assert Point(-0.5, 0.5).rounded() == (0, 0) or Point(-0.5, 0.5).rounded() == (-0, 0)


def test_rms_of_empty_is_zero():
    assert rms([]) == 0.0
    assert rms([3.0, 4.0]) == pytest.approx(math.sqrt(12.5))
