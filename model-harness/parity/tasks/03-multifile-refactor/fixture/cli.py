import sys
from decimal import Decimal

from core import reconcile_batch
from report import batch_summary


def main(argv):
    payments = [Decimal(a) for a in argv[1:-1]]
    statement_total = Decimal(argv[-1])
    reconcile_batch(payments, statement_total)   # validate before reporting
    print(batch_summary(payments, statement_total))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
