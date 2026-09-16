"""The calibration profile: anchors, landmarks, and how to move them.

A profile is the durable artefact of one cursor-park session. Captured once, it
stays valid for as long as the form's *internal* layout is unchanged — which is
to say, until Seradex ships a new build. Where the window sits on screen is
recovered per-run by `registration`, not baked in here.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Mapping

from .geometry import Point, Rect, Similarity
from .registration import Landmark, Registration


class CalibrationError(ValueError):
    """Raised when a profile is malformed or does not fit the screen it names."""


@dataclass(frozen=True)
class Anchor:
    """A calibrated click/type target, in the coordinates of the reference frame."""

    name: str
    point: Point
    kind: str = "field"  # field | button | dialog | checkbox
    note: str = ""


def _point_from(obj: Mapping[str, Any], where: str) -> Point:
    try:
        return Point(float(obj["x"]), float(obj["y"]))
    except (KeyError, TypeError, ValueError) as exc:
        raise CalibrationError(f"bad point at {where}: {obj!r}") from exc


def _rect_from(obj: Mapping[str, Any], where: str) -> Rect:
    try:
        return Rect(
            float(obj["left"]), float(obj["top"]), float(obj["right"]), float(obj["bottom"])
        )
    except (KeyError, TypeError, ValueError) as exc:
        raise CalibrationError(f"bad rect at {where}: {obj!r}") from exc


@dataclass(frozen=True)
class CalibrationProfile:
    screen: str
    window_title_pattern: str
    anchors: tuple[Anchor, ...]
    landmarks: tuple[Landmark, ...]
    reference_window: Rect | None = None
    seradex_version: str = ""
    captured_utc: str = ""
    notes: str = ""

    def anchor(self, name: str) -> Anchor:
        for a in self.anchors:
            if a.name == name:
                return a
        raise KeyError(f"no anchor named {name!r} in profile {self.screen!r}")

    @property
    def anchor_names(self) -> tuple[str, ...]:
        return tuple(a.name for a in self.anchors)

    # ---- serialisation -------------------------------------------------

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> "CalibrationProfile":
        for key in ("screen", "window_title_pattern", "anchors", "landmarks"):
            if key not in data:
                raise CalibrationError(f"profile missing required key {key!r}")

        anchors = tuple(
            Anchor(
                name=str(a["name"]),
                point=_point_from(a["point"], f"anchor {a.get('name')!r}"),
                kind=str(a.get("kind", "field")),
                note=str(a.get("note", "")),
            )
            for a in data["anchors"]
        )
        if not anchors:
            raise CalibrationError("profile defines no anchors")
        dupes = {n for n in (a.name for a in anchors) if [x.name for x in anchors].count(n) > 1}
        if dupes:
            raise CalibrationError(f"duplicate anchor name(s): {', '.join(sorted(dupes))}")

        landmarks = tuple(
            Landmark(
                name=str(m["name"]),
                text=str(m["text"]),
                point=_point_from(m["point"], f"landmark {m.get('name')!r}"),
                required=bool(m.get("required", False)),
            )
            for m in data["landmarks"]
        )

        ref = data.get("reference_window")
        return cls(
            screen=str(data["screen"]),
            window_title_pattern=str(data["window_title_pattern"]),
            anchors=anchors,
            landmarks=landmarks,
            reference_window=_rect_from(ref, "reference_window") if ref else None,
            seradex_version=str(data.get("seradex_version", "")),
            captured_utc=str(data.get("captured_utc", "")),
            notes=str(data.get("notes", "")),
        )

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "screen": self.screen,
            "window_title_pattern": self.window_title_pattern,
            "seradex_version": self.seradex_version,
            "captured_utc": self.captured_utc,
            "notes": self.notes,
            "anchors": [
                {
                    "name": a.name,
                    "kind": a.kind,
                    "note": a.note,
                    "point": {"x": a.point.x, "y": a.point.y},
                }
                for a in self.anchors
            ],
            "landmarks": [
                {
                    "name": m.name,
                    "text": m.text,
                    "required": m.required,
                    "point": {"x": m.point.x, "y": m.point.y},
                }
                for m in self.landmarks
            ],
        }
        if self.reference_window is not None:
            r = self.reference_window
            out["reference_window"] = {
                "left": r.left, "top": r.top, "right": r.right, "bottom": r.bottom
            }
        return out

    @classmethod
    def load(cls, path: str | Path) -> "CalibrationProfile":
        p = Path(path)
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise CalibrationError(f"{p}: invalid JSON: {exc}") from exc
        return cls.from_dict(data)

    def save(self, path: str | Path) -> None:
        payload = self.to_dict()
        if not payload["captured_utc"]:
            payload["captured_utc"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        Path(path).write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    def with_landmarks(self, landmarks: Iterable[Landmark]) -> "CalibrationProfile":
        return replace(self, landmarks=tuple(landmarks))


@dataclass(frozen=True)
class TargetSet:
    """Calibrated anchors pushed through the current frame's transform."""

    screen: str
    transform: Similarity
    points: Mapping[str, Point]
    registration: Registration | None = None

    def __getitem__(self, name: str) -> Point:
        try:
            return self.points[name]
        except KeyError as exc:
            raise KeyError(f"no anchor named {name!r} on screen {self.screen!r}") from exc

    def click_point(self, name: str) -> tuple[int, int]:
        """Integer screen coordinates, ready for SetCursorPos."""
        return self[name].rounded()

    def all_points(self) -> tuple[Point, ...]:
        return tuple(self.points.values())


def resolve(profile: CalibrationProfile, transform: Similarity,
            registration: Registration | None = None) -> TargetSet:
    """Apply a frame transform to every calibrated anchor."""
    return TargetSet(
        screen=profile.screen,
        transform=transform,
        points={a.name: transform.apply(a.point) for a in profile.anchors},
        registration=registration,
    )


def transform_from_window(reference: Rect, current: Rect,
                          *, allow_scale: bool = True) -> Similarity:
    """Second, independent estimate of the frame transform, from window geometry.

    Cheap and exact when the window merely moved, and it needs no OCR at all.
    Its value is as a cross-check: if this and the OCR registration disagree,
    something is wrong that neither one can see on its own — a second copy of
    the form, a stale window handle, a partially off-screen client area.
    """
    if reference.width <= 0 or reference.height <= 0:
        raise CalibrationError("reference window has no area")
    if current.width <= 0 or current.height <= 0:
        raise CalibrationError("current window has no area")

    if allow_scale:
        sx = current.width / reference.width
        sy = current.height / reference.height
        scale = (sx + sy) / 2.0
    else:
        scale = 1.0
    return Similarity(
        scale,
        current.left - scale * reference.left,
        current.top - scale * reference.top,
    )


def max_disagreement(a: Similarity, b: Similarity, probes: Iterable[Point]) -> float:
    """Largest pixel gap between two transforms over the points that matter.

    Compared at the anchors themselves rather than at the origin, because a
    small scale difference is harmless near the window's top-left and grows
    with distance — and the Save button is a long way from the top-left.
    """
    gaps = [a.apply(p).distance_to(b.apply(p)) for p in probes]
    return max(gaps) if gaps else 0.0
