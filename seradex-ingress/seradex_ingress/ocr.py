"""Turn a screenshot into positioned text lines.

Only `screen_text` touches pytesseract/PIL; everything below it is pure data
shaping so the matching logic can be tested without a screen or an OCR engine.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Sequence

from .geometry import Point, Rect


@dataclass(frozen=True)
class TextLine:
    """One OCR'd line of text and where it sits in screen coordinates."""

    text: str
    box: Rect
    confidence: float

    @property
    def anchor(self) -> Point:
        """The point a landmark is pinned to: the line's left-hand baseline-ish centre.

        Left edge rather than centre because a label's left edge is stable even
        when OCR clips or extends the tail of the word ("Invoice Date" vs
        "Invoice Date:"), and the centre would then drift by half the error.
        """
        return Point(self.box.left, self.box.center.y)


def lines_from_tesseract_data(
    data: Mapping[str, Sequence[Any]],
    *,
    min_word_confidence: float = 40.0,
) -> list[TextLine]:
    """Group `pytesseract.image_to_data(output_type=DICT)` words into lines.

    Tesseract reports per-word boxes; labels we care about are multi-word
    ("Invoice Date", "PO Number"), so words are regrouped by their
    block/paragraph/line indices and the boxes unioned.
    """
    required = ("text", "left", "top", "width", "height", "conf",
                "block_num", "par_num", "line_num")
    for key in required:
        if key not in data:
            raise KeyError(f"tesseract data missing column {key!r}")

    groups: dict[tuple[int, int, int], list[int]] = {}
    for i, raw in enumerate(data["text"]):
        text = str(raw).strip()
        if not text:
            continue
        try:
            conf = float(data["conf"][i])
        except (TypeError, ValueError):
            conf = -1.0
        if conf < min_word_confidence:
            continue
        key = (int(data["block_num"][i]), int(data["par_num"][i]), int(data["line_num"][i]))
        groups.setdefault(key, []).append(i)

    lines: list[TextLine] = []
    for key in sorted(groups):
        idxs = groups[key]
        words = [str(data["text"][i]).strip() for i in idxs]
        lefts = [float(data["left"][i]) for i in idxs]
        tops = [float(data["top"][i]) for i in idxs]
        rights = [float(data["left"][i]) + float(data["width"][i]) for i in idxs]
        bottoms = [float(data["top"][i]) + float(data["height"][i]) for i in idxs]
        confs = [float(data["conf"][i]) for i in idxs]
        lines.append(
            TextLine(
                text=" ".join(words),
                box=Rect(min(lefts), min(tops), max(rights), max(bottoms)),
                confidence=sum(confs) / len(confs),
            )
        )
    return lines


def offset_lines(lines: Sequence[TextLine], dx: float, dy: float) -> list[TextLine]:
    """Shift lines from image-local coordinates into screen coordinates.

    Needed whenever OCR runs on a cropped grab: `ImageGrab.grab(bbox=...)`
    returns boxes relative to the crop, but every anchor downstream is a screen
    coordinate that SetCursorPos will consume.
    """
    return [
        TextLine(
            text=ln.text,
            box=Rect(ln.box.left + dx, ln.box.top + dy, ln.box.right + dx, ln.box.bottom + dy),
            confidence=ln.confidence,
        )
        for ln in lines
    ]


def screen_text(
    image: Any,
    *,
    origin: Point = Point(0.0, 0.0),
    lang: str = "eng",
    config: str = "--psm 6",
    min_word_confidence: float = 40.0,
) -> list[TextLine]:
    """OCR a PIL image into screen-space text lines.

    `origin` is the screen coordinate of the image's top-left pixel — pass the
    crop box origin when the grab was not full-screen. `--psm 6` ("assume a
    uniform block of text") reads dense Win32 forms far better than the default
    page-segmentation mode, which hunts for prose columns that are not there.
    """
    import pytesseract  # imported lazily: absent on the dev box, present on the runner

    data = pytesseract.image_to_data(
        image, lang=lang, config=config, output_type=pytesseract.Output.DICT
    )
    lines = lines_from_tesseract_data(data, min_word_confidence=min_word_confidence)
    if origin.x or origin.y:
        lines = offset_lines(lines, origin.x, origin.y)
    return lines
