import {
  parseAmount,
  parseAmountColumn,
  matchTransactions,
  explainDifference,
  isLikelyTransposition,
  detectHeaderRow,
} from "../engine/index.js";

export interface ReconSummary {
  matchedPairs: number;
  unmatchedA: number;
  unmatchedB: number;
  residualCents: number;
  likelyTransposition: boolean;
  sampleMatches: Array<{ aRow: number; bRow: number; amountCents: number }>;
  parseFailures: number;
  text: string;
}

/**
 * Deterministically reconcile two selected columns (GL vs Bank amounts).
 * The model never computes this — it only renders the returned text.
 */
export function reconcileTwoColumns(
  values: Array<Array<string | number | null | undefined>>,
  colA: number,
  colB: number,
  opts: { toleranceCents?: number } = {},
): ReconSummary {
  const headerRow = detectHeaderRow(values);
  const data = values.slice(headerRow + 1);
  const a = parseAmountColumn(data, colA);
  const b = parseAmountColumn(data, colB);

  const aValid = a.filter((x): x is number => x !== null);
  const bValid = b.filter((x): x is number => x !== null);
  const parseFailures = (a.length - aValid.length) + (b.length - bValid.length);

  const { matches, unmatchedA, unmatchedB } = matchTransactions(aValid, bValid, {
    amountToleranceCents: opts.toleranceCents ?? 0,
  });

  const sumA = aValid.reduce((s, x) => s + x, 0);
  const sumB = bValid.reduce((s, x) => s + x, 0);
  const residualCents = explainDifference(sumA, sumB);
  const likelyTransposition = isLikelyTransposition(residualCents);

  const sampleMatches = matches.slice(0, 5);

  return {
    matchedPairs: matches.length,
    unmatchedA: unmatchedA.length,
    unmatchedB: unmatchedB.length,
    residualCents,
    likelyTransposition,
    sampleMatches,
    parseFailures,
    text: [
      `Reconciled ${aValid.length} GL rows vs ${bValid.length} bank rows.`,
      `Matched ${matches.length} one-to-one. Unmatched GL: ${unmatchedA.length}, unmatched bank: ${unmatchedB.length}.`,
      `GL sum: ${(sumA / 100).toFixed(2)}, Bank sum: ${(sumB / 100).toFixed(2)}.`,
      `Residual (GL - Bank): ${(residualCents / 100).toFixed(2)}.`,
      likelyTransposition
        ? `⚠ Residual is divisible by 9 — likely a digit transposition.`
        : `Residual not a transposition signature.`,
      parseFailures > 0 ? `⚠ ${parseFailures} cell(s) unparseable (flagged, not dropped).` : "",
    ].filter(Boolean).join("\n"),
  };
}

export function parseAmountSafe(v: string | number | null | undefined) {
  return parseAmount(v);
}