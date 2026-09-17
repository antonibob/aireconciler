"""Payment batch reconciliation."""

from decimal import Decimal


def reconcile_batch(payments, statement_total):
    """Return (total, variance) for a batch against a statement total."""
    total = sum(payments, Decimal("0.00"))
    return total, (total - statement_total)
