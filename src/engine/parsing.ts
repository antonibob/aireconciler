/**
 * Amount and table parsing — the "filthy export" layer.
 *
 * Deterministic: returns integer cents, never floats. Handles the ways real
 * bank/vendor exports represent money:
 *   (123.45)  -> -12345     parenthesized negative (accounting)
 *   1,234.56  -> 123456     thousands separators
 *   1.234,56  -> 123456     European decimal comma
 *   CAD $45.00 -> 4500      currency symbol + code
 *   45.00 DR  -> -4500      DR/CR suffix
 *   "45.00"    -> 4500      number stored as text
 *   CR  45.00 -> 4500       CR prefix
 *   1 234,56 (thin space) -> 123456
 */

export type ParsedAmount = { cents: number; ok: boolean };

/** Collapse thin/narrow spaces (U+2009, U+202F) and NBSP to plain ". */
function normalizeSpaces(s: string): string {
  return s.replace(/[\u202f\u2009\u00a0\u2007]/g, " ");
}

/**
 * Parse a single amount cell to integer cents. Returns ok:false if it can't be
 * interpreted rather than guessing.
 */
export function parseAmount(input: string | number | null | undefined): ParsedAmount {
  if (input === null || input === undefined || input === "") return { cents: 0, ok: false };
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return { cents: 0, ok: false };
    return { cents: Math.round(input * 100), ok: true };
  }

  let s = normalizeSpaces(String(input)).trim();

  // Credit/debit markers (suffix or prefix).
  let sign = 1;
  const dr = /\b(DR)\b/i;
  const cr = /\b(CR)\b/i;
  if (cr.test(s)) sign = -1;
  if (dr.test(s)) sign = 1;
  s = s.replace(/\b(?:DR|CR)\b/gi, "").trim();

  // Parenthesized negative: (123.45) or ( 123.45 ) -> -12345
  if (/^\(\s*-?[\d,.\s]+\)$/.test(s)) {
    sign = -1;
    s = s.replace(/^\(\s*|\s*\)$/g, "");
  }

  // Currency codes and symbols.
  s = s.replace(/\b(?:CAD|USD|EUR|GBP|CNY|INR|JPY|USD|MXN|AUD)\b/gi, "").trim();
  s = s.replace(/[$€£¥₹]/g, "").trim();

  // Strip thousand-separator commas/trailing .00 noise where safe.
  // Detect European decimal comma if there's a comma with exactly 2 decimals
  // and no thousands in groups.
  const euDecimal = /^\d{1,3}(?:[ .]\d{3})*,\d{2}$/.test(s);
  if (euDecimal) {
    s = s.replace(/[ .]/g, "").replace(",", ".");
  } else {
    s = s.replace(/,/g, ""); // thousands separators
  }

  // Collapse leftover spaces (thin-space thousands).
  s = s.replace(/\s+/g, "");
  if (s === "") return { cents: 0, ok: false };
  const n = Number(s);
  if (Number.isNaN(n) || !Number.isFinite(n)) return { cents: 0, ok: false };
  return { cents: Math.round(n * 100) * sign, ok: true };
}

/**
 * Parse a whole column of cells into cents. Cells that fail return null so the
 * caller can flag them (never silently drop → "flag, don't fix").
 */
export function parseAmountColumn(
  values: Array<Array<string | number | null | undefined>>,
  colIndex: number,
): Array<number | null> {
  return values.map((row) => {
    const parsed = parseAmount(row[colIndex]);
    return parsed.ok ? parsed.cents : null;
  });
}

/**
 * Detect the header row of a worksheet — the last row before the data that is
 * mostly text and has unique-ish labels. Cheap heuristic: scan first N rows;
 * the header is the first row where most cells are non-numeric strings.
 *
 * Returns -1 when no row looks like a header. Callers must distinguish that
 * from row 0: skipping "the header" on a headerless range silently eats the
 * first transaction.
 */
export function detectHeaderRow(
  values: Array<Array<string | number | null | undefined>>,
  sampleRows: number = 12,
): number {
  for (let r = 0; r < Math.min(sampleRows, values.length); r++) {
    const row = values[r];
    if (!row || row.length === 0) continue;
    const textCells = row.filter(
      (c) => typeof c === "string" && c.trim() !== "" && Number.isNaN(Number(c)) && parseAmount(c).ok === false,
    );
    const nonEmpty = row.filter((c) => c !== "" && c !== null && c !== undefined).length;
    // A header row has at least 2 populated cells (real column names), mostly text.
    if (nonEmpty >= 2 && textCells.length / nonEmpty > 0.6) return r;
  }
  return -1; // no header found — the range is all data
}