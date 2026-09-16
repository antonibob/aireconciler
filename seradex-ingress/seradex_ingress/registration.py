"""Re-register an existing pixel calibration against the current screen.

The insight this module is built on: the calibration captured by cursor-parking
is still good. What goes stale is only *where the form is*. So OCR does not need
to find every control from scratch — it needs to find a handful of stable text
landmarks, solve the transform that carries them from their calibrated positions
to their current ones, and push every calibrated anchor through it.

That turns a fragile per-field search into one over-determined fit with a
measurable residual, which is what makes it safe to gate on.
"""

from __future__ import annotations

import re
import statistics
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from typing import Sequence

from .geometry import FitError, Point, Similarity, fit_robust, residuals, rms
from .ocr import TextLine

# Tesseract's standard glyph confusions, folded to one representative each so
# "PO Number" surviving as "P0 Number" still matches.
_CONFUSABLES = str.maketrans({"0": "o", "1": "l", "5": "s", "8": "b", "2": "z", "6": "g"})
_NON_ALNUM = re.compile(r"[^a-z0-9]+")


def normalize(text: str) -> str:
    """Case-fold, drop punctuation and whitespace, fold confusable glyphs.

    Whitespace goes too, so a label OCR'd as "InvoiceDate" or "Invoice  Date:"
    lands on the same key as "Invoice Date".
    """
    return _NON_ALNUM.sub("", text.lower()).translate(_CONFUSABLES)


def similarity_ratio(a: str, b: str) -> float:
    """Fuzzy text agreement in [0, 1] on normalized forms."""
    na, nb = normalize(a), normalize(b)
    if not na or not nb:
        return 0.0
    if na == nb:
        return 1.0
    return SequenceMatcher(None, na, nb).ratio()


@dataclass(frozen=True)
class Landmark:
    """A text label whose screen position was recorded at calibration time."""

    name: str
    text: str
    point: Point
    required: bool = False
    """If True, failing to match this landmark fails the whole registration.

    Reserve it for labels unique to the screen you mean to be on — matching
    'Vendor Invoicing' is how you prove you are not looking at Sales Orders.
    """


@dataclass(frozen=True)
class Correspondence:
    landmark: Landmark
    line: TextLine
    score: float

    @property
    def pair(self) -> tuple[Point, Point]:
        return (self.landmark.point, self.line.anchor)


@dataclass(frozen=True)
class RegistrationPolicy:
    min_text_score: float = 0.82
    """Below this fuzzy ratio a line is not considered a candidate at all."""
    unambiguous_margin: float = 0.12
    """A landmark seeds the bootstrap if its best candidate beats the runner-up by this."""
    gate_radius_px: float = 120.0
    """Ambiguous candidates must land within this far of the bootstrap prediction."""
    min_landmarks: int = 3
    max_rms_px: float = 6.0
    max_outlier_fraction: float = 0.34
    """Refuse if this share of matched landmarks disagreed with the consensus fit.

    Rejecting a lone outlier is the point of the robust fit. Rejecting a third
    of them is a different statement: the labels are there but they are not
    arranged the way the profile says, which means this is not the screen the
    profile describes - a second copy of the form, a different Seradex build,
    or a stale frame composited from two moments.
    """
    scale_bounds: tuple[float, float] = (0.90, 1.10)
    allow_scale: bool = True


@dataclass(frozen=True)
class Registration:
    ok: bool
    transform: Similarity
    matched: tuple[Correspondence, ...] = ()
    rms_error: float = float("inf")
    reasons: tuple[str, ...] = ()
    unmatched: tuple[str, ...] = ()

    def require(self) -> Similarity:
        """Return the transform, or raise if the fit did not clear the gate."""
        if not self.ok:
            raise RegistrationError("; ".join(self.reasons) or "registration failed")
        return self.transform


class RegistrationError(RuntimeError):
    """Raised when the screen cannot be located confidently enough to type into."""


def _candidates(
    landmarks: Sequence[Landmark], lines: Sequence[TextLine], policy: RegistrationPolicy
) -> dict[int, list[tuple[int, float]]]:
    out: dict[int, list[tuple[int, float]]] = {}
    for li, lm in enumerate(landmarks):
        scored = [
            (ti, similarity_ratio(lm.text, line.text))
            for ti, line in enumerate(lines)
        ]
        hits = [(ti, s) for ti, s in scored if s >= policy.min_text_score]
        hits.sort(key=lambda t: -t[1])
        out[li] = hits
    return out


def match_landmarks(
    landmarks: Sequence[Landmark],
    lines: Sequence[TextLine],
    policy: RegistrationPolicy = RegistrationPolicy(),
) -> list[Correspondence]:
    """Pair reference landmarks with OCR'd lines, resolving duplicates by position.

    Two passes, because text alone is not enough: a form with 'Date' in three
    places gives three equally good text matches. The first pass uses only the
    landmarks whose match is unambiguous to bootstrap a rough translation; the
    second uses that prediction to pick the right instance of the ambiguous ones.
    """
    cands = _candidates(landmarks, lines, policy)

    seeds: list[Correspondence] = []
    ambiguous: list[int] = []
    for li, hits in cands.items():
        if not hits:
            continue
        best_ti, best_s = hits[0]
        runner_up = hits[1][1] if len(hits) > 1 else 0.0
        if len(hits) == 1 or (best_s - runner_up) >= policy.unambiguous_margin:
            seeds.append(Correspondence(landmarks[li], lines[best_ti], best_s))
        else:
            ambiguous.append(li)

    if not seeds:
        return []

    # Median rather than mean: one bad seed should not move the prediction.
    dx = statistics.median([c.line.anchor.x - c.landmark.point.x for c in seeds])
    dy = statistics.median([c.line.anchor.y - c.landmark.point.y for c in seeds])
    bootstrap = Similarity(1.0, dx, dy)

    taken = {id(c.line) for c in seeds}
    resolved = list(seeds)
    for li in ambiguous:
        lm = landmarks[li]
        predicted = bootstrap.apply(lm.point)
        best: tuple[float, int, float] | None = None
        for ti, score in cands[li]:
            line = lines[ti]
            if id(line) in taken:
                continue
            d = line.anchor.distance_to(predicted)
            if d > policy.gate_radius_px:
                continue
            if best is None or d < best[0]:
                best = (d, ti, score)
        if best is not None:
            _, ti, score = best
            taken.add(id(lines[ti]))
            resolved.append(Correspondence(lm, lines[ti], score))

    return resolved


def register(
    landmarks: Sequence[Landmark],
    lines: Sequence[TextLine],
    policy: RegistrationPolicy = RegistrationPolicy(),
) -> Registration:
    """Locate the form on screen, or explain why it could not be located.

    A failed registration is a *successful* outcome of this function: returning
    `ok=False` with reasons is the whole point, because the caller's alternative
    is typing an invoice into whatever happens to be under those coordinates.
    """
    matched = match_landmarks(landmarks, lines, policy)
    by_name = {c.landmark.name for c in matched}
    unmatched = tuple(lm.name for lm in landmarks if lm.name not in by_name)
    reasons: list[str] = []

    missing_required = [lm.name for lm in landmarks if lm.required and lm.name not in by_name]
    if missing_required:
        reasons.append(f"required landmark(s) not found: {', '.join(sorted(missing_required))}")

    if len(matched) < policy.min_landmarks:
        reasons.append(
            f"matched {len(matched)} landmark(s), need {policy.min_landmarks}"
        )
        return Registration(
            ok=False,
            transform=Similarity.IDENTITY,
            matched=tuple(matched),
            reasons=tuple(reasons),
            unmatched=unmatched,
        )

    pairs = [c.pair for c in matched]
    try:
        fit = fit_robust(
            pairs,
            allow_scale=policy.allow_scale,
            scale_bounds=policy.scale_bounds,
            min_inliers=policy.min_landmarks,
        )
    except FitError as exc:
        reasons.append(f"transform fit failed: {exc}")
        return Registration(
            ok=False,
            transform=Similarity.IDENTITY,
            matched=tuple(matched),
            reasons=tuple(reasons),
            unmatched=unmatched,
        )

    inliers = tuple(matched[i] for i in fit.inliers)
    if len(inliers) < policy.min_landmarks:
        reasons.append(
            f"only {len(inliers)} landmark(s) agreed on a transform, "
            f"need {policy.min_landmarks}"
        )

    rejected = len(matched) - len(inliers)
    if matched and (rejected / len(matched)) > policy.max_outlier_fraction:
        reasons.append(
            f"{rejected} of {len(matched)} matched landmarks disagreed with the "
            "consensus transform; this does not look like the calibrated screen"
        )

    error = rms(residuals(fit.transform, [c.pair for c in inliers]))
    if error > policy.max_rms_px:
        reasons.append(f"residual {error:.1f}px exceeds {policy.max_rms_px:.1f}px")

    lo, hi = policy.scale_bounds
    if not (lo <= fit.transform.scale <= hi):
        reasons.append(f"implausible scale {fit.transform.scale:.3f}")

    return Registration(
        ok=not reasons,
        transform=fit.transform,
        matched=inliers,
        rms_error=error,
        reasons=tuple(reasons),
        unmatched=unmatched,
    )


@dataclass(frozen=True)
class LandmarkProposal:
    landmark: Landmark
    confidence: float


def propose_landmarks(
    lines: Sequence[TextLine],
    *,
    count: int = 6,
    region: "Rect | None" = None,
    min_confidence: float = 80.0,
    min_chars: int = 3,
) -> list[LandmarkProposal]:
    """Pick well-spread, unambiguous labels to use as landmarks.

    Two properties decide whether a landmark set is any good, and neither is
    obvious when a human picks labels by eye:

    *Uniqueness* — a label that appears twice on the form can only be resolved
    positionally, which is circular when it is the thing establishing position.
    Repeated texts are dropped outright.

    *Spread* — three labels clustered in one corner pin translation but give
    almost no lever arm on scale, so a display-scale change reads as noise. So
    after seeding with the most confident candidate, each further pick is the
    one farthest from everything chosen so far (farthest-point sampling), which
    drives the set toward the corners of whatever region it has.
    """
    from .geometry import Rect  # local import keeps the module's import graph flat

    seen: dict[str, int] = {}
    for ln in lines:
        key = normalize(ln.text)
        seen[key] = seen.get(key, 0) + 1

    pool = [
        ln for ln in lines
        if seen[normalize(ln.text)] == 1
        and len(normalize(ln.text)) >= min_chars
        and ln.confidence >= min_confidence
        and (region is None or region.contains(ln.anchor))
    ]
    if not pool:
        return []

    chosen = [max(pool, key=lambda ln: ln.confidence)]
    remaining = [ln for ln in pool if ln is not chosen[0]]

    while remaining and len(chosen) < count:
        nxt = max(
            remaining,
            key=lambda ln: min(ln.anchor.distance_to(c.anchor) for c in chosen),
        )
        remaining.remove(nxt)
        chosen.append(nxt)

    return [
        LandmarkProposal(
            landmark=Landmark(
                name=normalize(ln.text)[:32] or f"landmark_{i}",
                text=ln.text,
                point=ln.anchor,
            ),
            confidence=ln.confidence,
        )
        for i, ln in enumerate(chosen)
    ]
