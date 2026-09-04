import type {
  Cents,
  CodedRow,
  Flag,
  GstHistory,
  ReconResult,
  StatementTotal,
  Transaction,
} from "./types.js";
import { cardToHolder } from "./mapping.js";
import {
  CONSISTENCY_MONTHS,
  gstConsistent,
  gstFromGross,
  normalizeVendor,
} from "./gst.js";
import { checkRow, isPlaceholderRow } from "./coding.js";

/** How one transaction nets to a GL column. The engine calls this per row.
 * The app wires it to the LLM or to the user's manual choice; the engine never
 * guesses on its own beyond routing unknown/ambiguous rows to Suspense.
 */
export type CodingDecision = (tx: Transaction) => string;

export const SUSPENSE_GL = "9999-99";
export const CC_CLEARING_GL = "8888-88";

export interface ReconConfig {
  transactions: Transaction[];
  statementTotals: StatementTotal[];
  /** prior months' GST treatment, { normalizedVendor -> hadGst } per month. */
  gstHistoryMonths: Array<Map<string, boolean>>;
  code: CodingDecision;
  /** expected Amount Due (statement) in cents, for the variance check. */
  statementAmountDueCents: Cents;
}

/**
 * Run the full reconciliation. Never throws on data shape — problems surface
 * as flags so the human decides, matching the "flag, don't silently fix" rule.
 */
export function reconcile(cfg: ReconConfig): ReconResult {
  const flags: Flag[] = [];
  const gstHistory: GstHistory = buildHistory(cfg.gstHistoryMonths);

  // 1. Drop placeholder ($0) rows from coding — they are payments/duplicates.
  const rows: CodedRow[] = [];
  let codedSumCents = 0;

  for (const tx of cfg.transactions) {
    const holder = cardToHolder(tx.last4);

    if (isPlaceholderRow(tx.amountCents)) {
      flags.push({
        kind: "duplicate",
        severity: "info",
        last4: tx.last4,
        description: tx.description,
        amountCents: tx.amountCents,
        message: `Skipped $0.00 placeholder row "${tx.description}" (not coded).`,
      });
      continue;
    }

    let glCode = SUSPENSE_GL;
    if (tx.amountCents < 0) {
      // Negative = credit/refund. Per spec, count it in Other credits, don't
      // guess a netting. Route to CC clearing so the human ties it to the refund.
      glCode = CC_CLEARING_GL;
      flags.push({
        kind: "credit",
        severity: "info",
        last4: tx.last4,
        description: tx.description,
        amountCents: tx.amountCents,
        message: `Credit/refund "${tx.description}" (${(tx.amountCents / 100).toFixed(2)}) → Other credits. Confirm it offsets the right charge.`,
      });
    } else if (tx.amountCents !== 0) {
      glCode = cfg.code(tx);
    }

    // GST gate: only claim GST for a 4-month-consistent vendor. The coding
    // decision may suggest it, but the engine enforces the gate.
    const vendor = normalizeVendor(tx.description);
    const consistent = gstConsistent(vendor, gstHistory, CONSISTENCY_MONTHS);
    const gstCents = tx.amountCents > 0 && consistent ? gstFromGross(tx.amountCents) : 0;
    if (tx.amountCents > 0 && gstCents > 0) {
      flags.push({
        kind: "gst-needs-evidence",
        severity: "info",
        last4: tx.last4,
        description: tx.description,
        amountCents: gstCents,
        message: `GST ${(gstCents / 100).toFixed(2)} claimed for "${vendor}" (4-month consistent). Auditable via vendor→GST map.`,
      });
    } else if (tx.amountCents > 0 && !consistent) {
      flags.push({
        kind: "gst-missing",
        severity: "info",
        last4: tx.last4,
        description: tx.description,
        amountCents: 0,
        message: `No GST for "${vendor}" — no 4-month consistency. Review if it should be a recurring, tax-eligible vendor.`,
      });
    }

    // Send rows destined for Suspense to the clearing account too; never guess.
    if (glCode === SUSPENSE_GL) {
      flags.push({
        kind: "suspense",
        severity: "warn",
        last4: tx.last4,
        description: tx.description,
        amountCents: tx.amountCents,
        message: `"${tx.description}" needs a GL code (→ Suspense #9999-99). Route or confirm before posting.`,
      });
    }

    const codedCents = glCode === SUSPENSE_GL ? 0 : tx.amountCents - gstCents;
    // Suspense rows are PARKED, not netted — no cross-foot to break. Only rows
    // actually coded to a GL column get the check. (Infra for future split-coding:
    // when a row spans >1 column, codedCents is the col-sum and residual matters.)
    const residual = glCode === SUSPENSE_GL ? 0 : checkRow(tx.amountCents, gstCents + codedCents);
    if (residual !== 0) {
      flags.push({
        kind: "check-uneven",
        severity: "error",
        last4: tx.last4,
        description: tx.description,
        amountCents: residual,
        message: `Row "${tx.description}" does not net to zero (residual ${(residual / 100).toFixed(2)}).`,
      });
    }

    rows.push({
      transaction: tx,
      glCode,
      gstCents,
      checkCents: residual,
      holder,
    });
    if (glCode !== SUSPENSE_GL) codedSumCents += tx.amountCents;
  }

  // 2. Per-card tie-out against the statement totals.
  const cardTieOuts = cfg.statementTotals.map((st) => {
    const sum = cfg.transactions
      .filter((t) => t.last4 === st.last4)
      .reduce((acc, t) => acc + t.amountCents, 0);
    const delta = sum - st.netCents;
    if (delta !== 0) {
      flags.push({
        kind: "sum-tie-out",
        severity: "error",
        last4: st.last4,
        amountCents: delta,
        message: `Card ${st.last4} raw sum ${(sum / 100).toFixed(2)} vs statement ${(st.netCents / 100).toFixed(2)} — off by ${(delta / 100).toFixed(2)}.`,
      });
    }
    return {
      last4: st.last4,
      holder: cardToHolder(st.last4),
      rawSumCents: sum,
      statementNetCents: st.netCents,
      deltaCents: delta,
    };
  });

  const netChargesCents = cardTieOuts.reduce((a, t) => a + t.rawSumCents, 0);
  const varianceCents = cfg.statementAmountDueCents - codedSumCents;

  return {
    rows,
    cardTieOuts,
    flags,
    netChargesCents,
    codedSumCents,
    varianceCents,
    passed:
      varianceCents === 0 &&
      cardTieOuts.every((t) => t.deltaCents === 0) &&
      rows.every((r) => r.checkCents === 0),
  };
}

function buildHistory(
  months: Array<Map<string, boolean>>,
): GstHistory {
  const out = new Map<string, boolean[]>();
  for (const month of months) {
    for (const [vendor, hadGst] of month) {
      const rec = out.get(vendor);
      if (rec) rec.push(hadGst);
      else out.set(vendor, [hadGst]);
    }
  }
  return out;
}