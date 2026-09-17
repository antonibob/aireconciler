from decimal import Decimal

from core import reconcile_batch
from report import batch_summary


def test_batch_ties_out():
    total, variance = reconcile_batch([Decimal("50.00"), Decimal("55.00")],
                                      Decimal("105.00"))
    assert total == Decimal("105.00")
    assert variance == Decimal("0.00")


def test_summary_flags_a_variance():
    assert "VARIANCE" in batch_summary([Decimal("50.00")], Decimal("105.00"))
