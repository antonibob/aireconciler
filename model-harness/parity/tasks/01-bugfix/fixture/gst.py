"""GST helpers. Canadian GST is 5%, included in the gross amount."""

from decimal import Decimal, ROUND_HALF_UP

GST_RATE = Decimal("0.05")


def gst_from_gross(gross: Decimal) -> Decimal:
    """Extract the GST portion from a GST-inclusive gross amount."""
    return (gross * GST_RATE).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def net_from_gross(gross: Decimal) -> Decimal:
    """The pre-tax amount of a GST-inclusive gross amount."""
    return (gross - gst_from_gross(gross)).quantize(
        Decimal("0.01"), rounding=ROUND_HALF_UP
    )
