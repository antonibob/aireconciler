from decimal import Decimal

from gst import gst_from_gross, net_from_gross


def test_gst_is_extracted_from_an_inclusive_gross():
    # $105.00 gross at 5% included means $5.00 of GST, not $5.25.
    assert gst_from_gross(Decimal("105.00")) == Decimal("5.00")


def test_net_and_gst_sum_back_to_gross():
    gross = Decimal("105.00")
    assert net_from_gross(gross) + gst_from_gross(gross) == gross


def test_realistic_invoice_total():
    assert gst_from_gross(Decimal("6297.26")) == Decimal("299.87")
