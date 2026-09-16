"""Top level: screenshot text in, verified click targets out.

This is what replaces cursor-park calibration at run time. The contract is
deliberately narrow — it either hands back every anchor for the current frame,
or it hands back reasons and no coordinates at all. There is no partial answer,
because a partially-correct coordinate set is exactly how an invoice ends up
typed into the wrong field.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Sequence

from .calibration import (
    CalibrationProfile,
    TargetSet,
    max_disagreement,
    resolve,
    transform_from_window,
)
from .geometry import Point, Rect, Similarity
from .ocr import TextLine
from .registration import Registration, RegistrationPolicy, register


@dataclass(frozen=True)
class RetargetPolicy:
    registration: RegistrationPolicy = field(default_factory=RegistrationPolicy)
    require_window_crosscheck: bool = True
    """Demand that window geometry independently confirms the OCR fit.

    Two estimators that agree are worth far more than one that is confident.
    Turn this off only if you cannot get a window rect at all, and understand
    that you are then trusting OCR alone to tell you the form moved.
    """
    max_estimator_disagreement_px: float = 8.0


@dataclass(frozen=True)
class RetargetResult:
    ok: bool
    targets: TargetSet | None = None
    registration: Registration | None = None
    disagreement_px: float | None = None
    reasons: tuple[str, ...] = ()

    def require(self) -> TargetSet:
        if not self.ok or self.targets is None:
            raise RetargetError("; ".join(self.reasons) or "retargeting failed")
        return self.targets


class RetargetError(RuntimeError):
    """Raised when the form's position on screen could not be established."""


def search_region(window: Rect, pad: float = 24.0) -> tuple[int, int, int, int]:
    """An ImageGrab bbox covering the form plus a margin.

    Cropping to the window is worth doing: Tesseract on a single 1080p region
    is several times faster than on a dual-monitor virtual desktop, and every
    word it does not read is a word that cannot be mis-matched to a landmark.
    """
    return (
        int(window.left - pad),
        int(window.top - pad),
        int(window.right + pad),
        int(window.bottom + pad),
    )


def retarget(
    profile: CalibrationProfile,
    lines: Sequence[TextLine],
    *,
    window_rect: Rect | None = None,
    policy: RetargetPolicy = RetargetPolicy(),
) -> RetargetResult:
    """Locate `profile`'s form in the current frame and move its anchors onto it."""
    reg = register(profile.landmarks, lines, policy.registration)
    if not reg.ok:
        return RetargetResult(ok=False, registration=reg, reasons=reg.reasons)

    transform: Similarity = reg.transform
    reasons: list[str] = []
    disagreement: float | None = None

    if policy.require_window_crosscheck:
        if profile.reference_window is None:
            reasons.append(
                "window cross-check required but the profile records no "
                "reference_window - recapture the profile, or set "
                "require_window_crosscheck=False and accept OCR-only targeting"
            )
        elif window_rect is None:
            reasons.append(
                "window cross-check required but no current window rect was supplied"
            )
        else:
            window_transform = transform_from_window(profile.reference_window, window_rect)
            probes = [a.point for a in profile.anchors]
            disagreement = max_disagreement(transform, window_transform, probes)
            if disagreement > policy.max_estimator_disagreement_px:
                reasons.append(
                    f"OCR and window-geometry transforms disagree by "
                    f"{disagreement:.1f}px (limit {policy.max_estimator_disagreement_px:.1f}px) "
                    "- possible duplicate form, stale window handle, or clipped client area"
                )

    if reasons:
        return RetargetResult(
            ok=False,
            registration=reg,
            disagreement_px=disagreement,
            reasons=tuple(reasons),
        )

    return RetargetResult(
        ok=True,
        targets=resolve(profile, transform, reg),
        registration=reg,
        disagreement_px=disagreement,
    )


def describe(result: RetargetResult) -> str:
    """One-line summary for the watchdog log."""
    if not result.ok:
        return f"RETARGET FAILED: {'; '.join(result.reasons)}"
    reg = result.registration
    bits = [f"ok scale={result.targets.transform.scale:.4f}"]  # type: ignore[union-attr]
    if reg is not None:
        bits.append(f"landmarks={len(reg.matched)} rms={reg.rms_error:.2f}px")
        if reg.unmatched:
            bits.append(f"unmatched={','.join(reg.unmatched)}")
    if result.disagreement_px is not None:
        bits.append(f"crosscheck={result.disagreement_px:.2f}px")
    return "RETARGET " + " ".join(bits)
