"""Pixel geometry and the similarity fit used to re-register a calibration.

Deliberately dependency-free: this is the part of the targeting layer that has
to be provable, so it must run (and be tested) off the Windows box.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Iterable, Sequence


@dataclass(frozen=True)
class Point:
    x: float
    y: float

    def __add__(self, other: "Point") -> "Point":
        return Point(self.x + other.x, self.y + other.y)

    def __sub__(self, other: "Point") -> "Point":
        return Point(self.x - other.x, self.y - other.y)

    def distance_to(self, other: "Point") -> float:
        return math.hypot(self.x - other.x, self.y - other.y)

    def rounded(self) -> tuple[int, int]:
        """Screen coordinates SetCursorPos will accept."""
        return (int(round(self.x)), int(round(self.y)))


@dataclass(frozen=True)
class Rect:
    left: float
    top: float
    right: float
    bottom: float

    @property
    def width(self) -> float:
        return self.right - self.left

    @property
    def height(self) -> float:
        return self.bottom - self.top

    @property
    def center(self) -> Point:
        return Point((self.left + self.right) / 2.0, (self.top + self.bottom) / 2.0)

    def contains(self, p: Point, margin: float = 0.0) -> bool:
        return (
            self.left + margin <= p.x <= self.right - margin
            and self.top + margin <= p.y <= self.bottom - margin
        )


@dataclass(frozen=True)
class Similarity:
    """x' = scale*x + dx,  y' = scale*y + dy.

    Screens translate and (under RDP display scaling) zoom, but they do not
    rotate or shear, so uniform scale plus translation is the whole model.
    """

    scale: float
    dx: float
    dy: float

    def apply(self, p: Point) -> Point:
        return Point(self.scale * p.x + self.dx, self.scale * p.y + self.dy)

    def apply_rect(self, r: Rect) -> Rect:
        a = self.apply(Point(r.left, r.top))
        b = self.apply(Point(r.right, r.bottom))
        return Rect(a.x, a.y, b.x, b.y)


#: No-op transform: the window has not moved.
Similarity.IDENTITY = Similarity(1.0, 0.0, 0.0)  # type: ignore[attr-defined]


class FitError(ValueError):
    """Raised when a transform cannot be estimated from the given pairs."""


def fit_translation(pairs: Sequence[tuple[Point, Point]]) -> Similarity:
    """Least-squares translation (scale pinned to 1). Needs >= 1 pair.

    Pinning scale is the right default: a RemoteApp window that merely moved
    has not changed size, and a one-landmark translation is far safer than a
    two-landmark scale estimate that a single OCR jitter can swing.
    """
    if not pairs:
        raise FitError("no landmark pairs")
    dx = sum(q.x - p.x for p, q in pairs) / len(pairs)
    dy = sum(q.y - p.y for p, q in pairs) / len(pairs)
    return Similarity(1.0, dx, dy)


def fit_similarity(pairs: Sequence[tuple[Point, Point]]) -> Similarity:
    """Least-squares uniform-scale + translation. Needs >= 2 non-coincident pairs."""
    if len(pairs) < 2:
        raise FitError("similarity fit needs at least 2 landmark pairs")

    n = float(len(pairs))
    pbar = Point(sum(p.x for p, _ in pairs) / n, sum(p.y for p, _ in pairs) / n)
    qbar = Point(sum(q.x for _, q in pairs) / n, sum(q.y for _, q in pairs) / n)

    num = 0.0
    den = 0.0
    for p, q in pairs:
        pc, qc = p - pbar, q - qbar
        num += pc.x * qc.x + pc.y * qc.y
        den += pc.x * pc.x + pc.y * pc.y

    if den < 1e-9:
        raise FitError("landmarks are coincident; scale is unobservable")

    scale = num / den
    return Similarity(scale, qbar.x - scale * pbar.x, qbar.y - scale * pbar.y)


def residuals(transform: Similarity, pairs: Iterable[tuple[Point, Point]]) -> list[float]:
    return [transform.apply(p).distance_to(q) for p, q in pairs]


def rms(values: Sequence[float]) -> float:
    if not values:
        return 0.0
    return math.sqrt(sum(v * v for v in values) / len(values))


def _median(values: Sequence[float]) -> float:
    if not values:
        raise FitError("median of empty sequence")
    s = sorted(values)
    mid = len(s) // 2
    return s[mid] if len(s) % 2 else (s[mid - 1] + s[mid]) / 2.0


@dataclass(frozen=True)
class RobustFit:
    transform: Similarity
    inliers: tuple[int, ...]
    """Indices into the original pairs sequence that survived outlier rejection."""
    rms_error: float


def fit_robust(
    pairs: Sequence[tuple[Point, Point]],
    *,
    allow_scale: bool = True,
    min_pairs_for_scale: int = 3,
    scale_bounds: tuple[float, float] = (0.90, 1.10),
    outlier_k: float = 3.0,
    min_inliers: int = 1,
    max_passes: int = 3,
) -> RobustFit:
    """Fit a transform, discarding landmarks that disagree with the consensus.

    One mis-OCR'd label ("Total" matched to the wrong row) is enough to drag a
    plain least-squares fit several pixels sideways, which on a segmented date
    field is the difference between the month box and the day box. So: fit,
    measure, drop anything beyond `outlier_k` MADs of the median residual, refit.

    Scale is only estimated when there is enough evidence for it
    (`min_pairs_for_scale`) and the answer is physically plausible
    (`scale_bounds`); otherwise it falls back to pure translation.
    """
    if not pairs:
        raise FitError("no landmark pairs")

    idx = list(range(len(pairs)))

    def _fit(active: list[int]) -> Similarity:
        subset = [pairs[i] for i in active]
        if allow_scale and len(subset) >= min_pairs_for_scale:
            try:
                candidate = fit_similarity(subset)
            except FitError:
                return fit_translation(subset)
            lo, hi = scale_bounds
            if lo <= candidate.scale <= hi:
                return candidate
            # Implausible zoom -> almost certainly a bad correspondence, not a
            # real display-scale change. Fall back rather than trust it.
        return fit_translation(subset)

    transform = _fit(idx)

    for _ in range(max_passes):
        res = residuals(transform, [pairs[i] for i in idx])
        if len(idx) <= max(min_inliers, 2):
            break
        med = _median(res)
        mad = _median([abs(r - med) for r in res])
        # 1.4826 scales MAD to a normal-consistent sigma; the floor keeps a
        # perfectly-consistent fit from rejecting sub-pixel noise.
        sigma = max(1.4826 * mad, 0.5)
        keep = [i for i, r in zip(idx, res) if r <= med + outlier_k * sigma]
        if len(keep) == len(idx) or len(keep) < max(min_inliers, 2):
            break
        idx = keep
        transform = _fit(idx)

    final = residuals(transform, [pairs[i] for i in idx])
    return RobustFit(transform=transform, inliers=tuple(idx), rms_error=rms(final))
