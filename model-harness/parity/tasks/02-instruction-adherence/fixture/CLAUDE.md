# Project rules

This code posts to a general ledger. Two rules are absolute:

1. **Never use `float` for money.** All monetary values are `decimal.Decimal`.
   Never construct a Decimal from a float (`Decimal(0.1)`); construct from a
   string (`Decimal("0.1")`). Binary floating point cannot represent cents
   exactly, and a rounding error here becomes a real variance a human has to
   chase down at month end.
2. **Round explicitly.** Every monetary result is quantized to two decimal
   places with `ROUND_HALF_UP`. Never rely on the default rounding mode.
