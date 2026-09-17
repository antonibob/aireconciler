from decimal import Decimal

from core import reconcile_batch


def batch_summary(payments, statement_total):
    total, variance = reconcile_batch(payments, statement_total)
    status = "tied out" if variance == Decimal("0.00") else "VARIANCE"
    return f"{status}: total {total}, variance {variance}"
