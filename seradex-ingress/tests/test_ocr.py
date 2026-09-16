import pytest

from seradex_ingress.geometry import Point, Rect
from seradex_ingress.ocr import TextLine, lines_from_tesseract_data, offset_lines


def tess(words):
    """Build a pytesseract image_to_data DICT from (text, l, t, w, h, conf, line) tuples."""
    data = {k: [] for k in ("text", "left", "top", "width", "height", "conf",
                            "block_num", "par_num", "line_num")}
    for text, l, t, w, h, conf, line in words:
        data["text"].append(text)
        data["left"].append(l)
        data["top"].append(t)
        data["width"].append(w)
        data["height"].append(h)
        data["conf"].append(conf)
        data["block_num"].append(1)
        data["par_num"].append(1)
        data["line_num"].append(line)
    return data


def test_words_on_one_line_become_one_landmark():
    """'Invoice Date' arrives as two words; the landmark is the pair."""
    data = tess([
        ("Invoice", 100, 200, 60, 14, 96, 1),
        ("Date", 165, 200, 40, 14, 94, 1),
        ("Total", 100, 240, 42, 14, 91, 2),
    ])

    lines = lines_from_tesseract_data(data)

    assert [ln.text for ln in lines] == ["Invoice Date", "Total"]
    assert lines[0].box.left == 100
    assert lines[0].box.right == 205
    assert lines[0].confidence == pytest.approx(95.0)


def test_low_confidence_words_are_dropped():
    data = tess([
        ("PO", 10, 10, 20, 12, 95, 1),
        ("Numbor", 32, 10, 50, 12, 11, 1),
    ])

    lines = lines_from_tesseract_data(data, min_word_confidence=40.0)

    assert [ln.text for ln in lines] == ["PO"]


def test_blank_and_whitespace_words_are_ignored():
    data = tess([("", 0, 0, 0, 0, 95, 1), ("   ", 0, 0, 0, 0, 95, 1),
                 ("Save", 10, 10, 30, 12, 95, 1)])

    assert [ln.text for ln in lines_from_tesseract_data(data)] == ["Save"]


def test_non_numeric_confidence_is_treated_as_unusable():
    data = tess([("Approved", 10, 10, 60, 12, "-1", 1)])

    assert lines_from_tesseract_data(data) == []


def test_missing_column_is_an_explicit_error():
    data = tess([("Save", 10, 10, 30, 12, 95, 1)])
    del data["line_num"]

    with pytest.raises(KeyError, match="line_num"):
        lines_from_tesseract_data(data)


def test_anchor_is_the_left_edge_at_mid_height():
    """Left edge, because OCR clipping the tail of a label must not move it."""
    line = TextLine("Invoice Date", Rect(100, 200, 205, 214), 95.0)

    assert line.anchor == Point(100, 207)


def test_cropped_grabs_are_lifted_into_screen_space():
    data = tess([("Save", 10, 20, 30, 12, 95, 1)])
    lines = lines_from_tesseract_data(data)

    shifted = offset_lines(lines, 1920, 300)

    assert shifted[0].box.left == 1930
    assert shifted[0].box.top == 320
    assert shifted[0].text == "Save"
