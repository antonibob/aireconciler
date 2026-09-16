"""Self-calibrating, guarded input targeting for the Seradex AP watchdog.

Two problems, two layers:

  `registration` + `calibration` + `retarget`
      Find the form wherever it is now, so anchors survive the window moving.
      Pure geometry and text matching — runs and is tested anywhere.

  `guards`
      Refuse to send input unless the session, the frame and the foreground
      window are all what they are supposed to be.

`win32_adapters` supplies the facts the guards judge, and is the only
Windows-only module.
"""

from .calibration import Anchor, CalibrationError, CalibrationProfile, TargetSet
from .geometry import Point, Rect, Similarity
from .guards import (
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
    preflight,
)
from .ocr import TextLine, lines_from_tesseract_data, screen_text
from .registration import (
    Landmark,
    LandmarkProposal,
    Registration,
    RegistrationPolicy,
    propose_landmarks,
    register,
)
from .retarget import RetargetPolicy, RetargetResult, describe, retarget, search_region

__version__ = "0.1.0"

__all__ = [
    "Anchor", "CalibrationError", "CalibrationProfile", "TargetSet",
    "Point", "Rect", "Similarity",
    "FramePolicy", "FrameStats", "GuardResult", "GuardViolation",
    "SessionFacts", "SessionPolicy", "WindowFacts", "WindowPolicy",
    "check_frame", "check_session", "check_window", "preflight",
    "TextLine", "lines_from_tesseract_data", "screen_text",
    "Landmark", "LandmarkProposal", "Registration", "RegistrationPolicy",
    "propose_landmarks", "register",
    "RetargetPolicy", "RetargetResult", "describe", "retarget", "search_region",
    "__version__",
]
