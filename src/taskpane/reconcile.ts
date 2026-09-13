import {
  parseAmount,
  parseAmountColumn,
  matchIndexed,
  explainDifference,
  isLikelyTransposition,
  detectHeaderRow,
  type Indexed,
} from "../engine/index.js";

/** A cell that could not be read as money, kept with its real row. */
export interface ParseFailure {
  row: number;
  side: "A" | "B";
  raw: string;
}

export interface ReconSummary {
  matchedPairs: number;
  unmatchedA: number[];
  unmatchedB: number[];
  residualCents: number;
  likelyTransposition: boolean;
  sumACents: number;
  sumBCents: number;
  matches: Array<{ aRow: number; bRow: number; amountCents: number }>;
  parseFailures: ParseFailure[];
  headerRow: number;
  text: string;
}

/**
 * Deterministically reconcile two columns (GL vs bank). The model never
 * computes this — it calls this as a tool and reports what comes back.
 *
 * Every row number here is an offset into `values` as given, so it maps
 * straight back to a cell the reviewer can click. Unparseable cells are
 * reported with their row rather than quietly compacted away.
 */
export function reconcileTwoColumns(
  values: Array<Array<string | number | null | undefined>>,
  colA: number,
  colB: number,
  opts: { toleranceCents?: number } = {},
): ReconSummary {
  const headerRow = detectHeaderRow(values);
  const firstDataRow = headerRow + 1; // -1 means no header, so start at 0
  const data = values.slice(firstDataRow);

  const rawA = parseAmountColumn(data, colA);
  const rawB = parseAmountColumn(data, colB);

  const a: Indexed[] = [];
  const b: Indexed[] = [];
  const parseFailures: ParseFailure[] = [];

  const collect = (raw: Array<number | null>, into: Indexed[], col: number, side: "A" | "B") => {
    raw.forEach((cents, i) => {
      const sheetRow = firstDataRow + i;
      const cell = data[i]?.[col];
      // A blank cell is absence, not a parse failure; only flag real content.
      if (cents === null) {
        if (cell !== null && cell !== undefined && String(cell).trim() !== "") {
          parseFailures.push({ row: sheetRow, side, raw: String(cell) });
        }
        return;
      }
      into.push({ value: cents, row: sheetRow });
    });
  };
  collect(rawA, a, colA, "A");
  collect(rawB, b, colB, "B");

  const { matches, unmatchedA, unmatchedB } = matchIndexed(a, b, {
    amountToleranceCents: opts.toleranceCents ?? 0,
  });

  const sumACents = a.reduce((s, x) => s + x.value, 0);
  const sumBCents = b.reduce((s, x) => s + x.value, 0);
  const residualCents = explainDifference(sumACents, sumBCents);
  const likelyTransposition = isLikelyTransposition(residualCents);

  const money = (c: number) => (c / 100).toFixed(2);
  const text = [
    `Reconciled ${a.length} GL rows against ${b.length} bank rows.`,
    `Matched ${matches.length} one-to-one. Unmatched GL: ${unmatchedA.length}, unmatched bank: ${unmatchedB.length}.`,
    `GL total ${money(sumACents)}, bank total ${money(sumBCents)}, residual ${money(residualCents)}.`,
    residualCents === 0
      ? "Residual is nil — the two sides agree."
      : likelyTransposition
        ? "Residual divides by 9 — check for transposed digits."
        : "Residual does not match a transposition signature.",
    parseFailures.length > 0
      ? `${parseFailures.length} cell(s) could not be read as amounts and are excluded from the totals (rows ${parseFailures
          .slice(0, 5)
          .map((f) => f.row + 1)
          .join(", ")}${parseFailures.length > 5 ? ", …" : ""}). Resolve these before relying on the residual.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    matchedPairs: matches.length,
    unmatchedA,
    unmatchedB,
    residualCents,
    likelyTransposition,
    sumACents,
    sumBCents,
    matches,
    parseFailures,
    headerRow,
    text,
  };
}

export function parseAmountSafe(v: string | number | null | undefined) {
  return parseAmount(v);
}
