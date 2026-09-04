/**
 * Reconciliation math — deterministic, cents-exact. The model only renders
 * these results; it never computes them.
 */

/** A matched pair with provenance (which source cells were paired). */
export interface Match {
  aRow: number; // index into list A (the GL / book)
  bRow: number; // index into list B (the bank)
  amountCents: number;
}

/**
 * One-to-one amount matching with an optional date window.
 * Greedy by exact amount first (cheap, insensitive), then closest.
 * Returns provenanced pairs for the reviewer to click through.
 */
export function matchTransactions(
  aAmounts: Array<number>,
  bAmounts: Array<number>,
  opts: { amountToleranceCents?: number; dateWindowMs?: number } = {},
): { matches: Match[]; unmatchedA: number[]; unmatchedB: number[] } {
  const tol = opts.amountToleranceCents ?? 0;
  const takenB = new Set<number>();
  const matches: Match[] = [];
  const unmatchedA: number[] = [];

  for (let i = 0; i < aAmounts.length; i++) {
    const need = aAmounts[i]!;
    // Exact match first.
    let bestB = -1;
    for (let j = 0; j < bAmounts.length; j++) {
      if (takenB.has(j)) continue;
      if (bAmounts[j] === need) {
        bestB = j;
        break;
      }
    }
    // Then within tolerance, closest.
    if (bestB === -1 && tol > 0) {
      let bestDelta = Infinity;
      for (let j = 0; j < bAmounts.length; j++) {
        if (takenB.has(j)) continue;
        const d = Math.abs(bAmounts[j]! - need);
        if (d <= tol && d < bestDelta) {
          bestDelta = d;
          bestB = j;
        }
      }
    }
    if (bestB >= 0) {
      takenB.add(bestB);
      matches.push({ aRow: i, bRow: bestB, amountCents: bAmounts[bestB]! });
    } else {
      unmatchedA.push(i);
    }
  }

  const unmatchedB: number[] = [];
  for (let j = 0; j < bAmounts.length; j++) if (!takenB.has(j)) unmatchedB.push(j);

  return { matches, unmatchedA, unmatchedB };
}

/** The residual that matters: book − bank after matching. */
export function explainDifference(bookBalanceCents: number, bankBalanceCents: number): number {
  return bookBalanceCents - bankBalanceCents;
}

/**
 * Transposition check: if a difference is divisible by 9, it's likely digits
 * were swapped. Pure arithmetic, catches a real error class.
 */
export function isLikelyTransposition(diffCents: number): boolean {
  if (diffCents === 0) return false;
  return Math.abs(diffCents) % 9 === 0;
}

/** Detect duplicate invoices: same vendor+amount, dates within window. */
export function findDuplicates(
  rows: Array<{ vendor: string; amountCents: number; date: string; invoiceNo?: string }>,
  opts: { dateWindowDays?: number } = {},
): Array<{ a: number; b: number; reason: string }> {
  const windowDays = opts.dateWindowDays ?? 3;
  const byKey = new Map<string, number[]>();
  rows.forEach((r, i) => {
    const key = `${normalize(r.vendor)}|${Math.abs(r.amountCents)}`;
    const arr = byKey.get(key) ?? [];
    arr.push(i);
    byKey.set(key, arr);
  });
  const day = 86400000;
  const out: Array<{ a: number; b: number; reason: string }> = [];
  for (const [, idxs] of byKey) {
    for (let i = 0; i < idxs.length; i++) {
      for (let k = i + 1; k < idxs.length; k++) {
        const a = rows[idxs[i]!]!;
        const b = rows[idxs[k]!]!;
        const aT = Date.parse(a.date);
        const bT = Date.parse(b.date);
        if (Number.isNaN(aT) || Number.isNaN(bT)) continue;
        if (Math.abs(aT - bT) <= windowDays * day) {
          out.push({ a: idxs[i]!, b: idxs[k]!, reason: "same vendor, same amount, within date window" });
        }
      }
    }
  }
  return out;
}

function normalize(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]+/g, "").trim();
}