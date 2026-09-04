import type { Cents } from "./types.js";

/** True for the $0.00 placeholder/payment rows (e.g. "TD CANADA TRUST") that
 * the spec says to SKIP in the coding sheet and checklist. */
export function isPlaceholderRow(amountCents: Cents): boolean {
  return amountCents === 0;
}

/**
 * Cross-foot check for one coded row. The spec's `Check` column:
 *   Check = Amount − SUM(all coded net columns for that row)
 * and must be 0 when fully coded. Anything else means the row did not net out.
 *
 * @param amountCents the raw transaction amount
 * @param codedCents  the sum of coded net columns (excluding the check)
 * @returns the residual that must be zero for the row to be clean
 */
export function checkRow(amountCents: Cents, codedCents: Cents): Cents {
  return amountCents - codedCents;
}

/**
 * Zero-dollar amount test with exact cents, no float surprises.
 */
export function isZero(c: Cents): boolean {
  return c === 0;
}