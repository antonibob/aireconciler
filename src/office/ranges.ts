/**
 * Office.js wiring — the only layer that touches the Excel host. Everything
 * else (engine, model) is pure and fully unit-tested; these helpers are thin
 * typed adapters the taskpane calls.
 *
 * We deliberately use small STRUCTURAL types here instead of the deprecated
 * @microsoft/office-js ambient globals. This keeps the adapter the same length
 * and lets it type-check in CI (no Office host on the runner). At runtime the
 * real Excel.OfficeExtension objects satisfy these shapes structurally.
 */

import type { Transaction } from "../engine/index.js";

/** Minimal structural view of Excel.Range used by adapters. */
export interface RangeLike {
  values: Array<Array<string | number | null | undefined>>;
}

/** Minimal structural view of Excel.Worksheet used by adapters. */
export interface WorksheetLike {
  getUsedRange(): { rowCount: number };
  getRangeByIndexes(
    startRow: number,
    startCol: number,
    rowCount: number,
    colCount: number,
  ): {
    values: Array<Array<string | number | null>>;
    getFormat(): { autofitColumns(): void };
  };
}

/**
 * Read the statement export into Transactions.
 * Expects a header row followed by [Date, Description, Amount(-/+, signed), Last4].
 * Amounts may arrive as strings from a CSV-shaped sheet; we coerce to cents.
 */
export function readTransactions(range: RangeLike): Transaction[] {
  return range.values
    .slice(1)
    .filter((row) => row.some((c) => c !== "" && c !== null && c !== undefined))
    .map((row): Transaction => ({
      date: String(row[0] ?? ""),
      description: String(row[1] ?? ""),
      amountCents: Math.round(Number(row[2] ?? 0) * 100),
      last4: String(row[3] ?? "").trim(),
    }));
}

/** Append the review table / audit trail to a worksheet, skipping to a 3-row gap. */
export function writeAuditTable(
  sheet: WorksheetLike,
  headers: string[],
  rows: Array<Array<string | number>>,
): void {
  const start = sheet.getUsedRange().rowCount + 3;
  const dest = sheet.getRangeByIndexes(start, 0, rows.length + 1, headers.length);
  dest.values = [headers, ...rows.map((r) => r.map(String))];
  dest.getFormat().autofitColumns();
}

/** Parse a per-card statement-total range into { last4, netCents }. */
export function parseStatementTotals(
  values: Array<Array<string | number | null>>,
  cardIndex: number,
): Array<{ last4: string; netCents: number }> {
  return values
    .map((row) => ({
      last4: String(row[cardIndex]).trim(),
      netCents: Math.round(Number(row[0]) * 100),
    }))
    .filter((r) => r.last4.length === 4);
}