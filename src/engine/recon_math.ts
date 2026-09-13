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
 * An amount tied to the worksheet row it came from.
 *
 * Callers must not compact their arrays before matching: dropping unparseable
 * cells shifts every later index, so a reported "row 12" stops meaning row 12
 * on the sheet. Carrying the row explicitly keeps the audit trail true.
 */
export interface Indexed {
  value: number;
  row: number;
}

/**
 * One-to-one amount matching, exact first then within tolerance.
 *
 * Exact matching buckets the B side by amount, so the whole pass is O(n + m)
 * rather than the O(n x m) scan this replaced — the difference between a few
 * milliseconds and half a minute on a year of transactions.
 *
 * Within a bucket, candidates are consumed in row order, which keeps matching
 * deterministic when the same amount appears many times (routine in AP).
 */
export function matchIndexed(
  a: Indexed[],
  b: Indexed[],
  opts: { amountToleranceCents?: number } = {},
): { matches: Match[]; unmatchedA: number[]; unmatchedB: number[] } {
  const tol = opts.amountToleranceCents ?? 0;
  const matches: Match[] = [];
  const unmatchedA: number[] = [];
  const taken = new Set<number>(); // positions within b, not sheet rows

  // amount -> queue of positions in b, in row order.
  const buckets = new Map<number, number[]>();
  b.forEach((entry, pos) => {
    const q = buckets.get(entry.value);
    if (q) q.push(pos);
    else buckets.set(entry.value, [pos]);
  });
  // Consumed from the front, so each bucket stays a cheap pointer bump.
  const cursors = new Map<number, number>();

  const takeExact = (value: number): number => {
    const q = buckets.get(value);
    if (!q) return -1;
    let c = cursors.get(value) ?? 0;
    while (c < q.length && taken.has(q[c]!)) c++;
    cursors.set(value, c);
    return c < q.length ? q[c]! : -1;
  };

  // Only built when a tolerance is in play; exact matching does not need it.
  const sorted = tol > 0 ? b.map((e, pos) => ({ ...e, pos })).sort((x, y) => x.value - y.value) : [];

  const takeNearest = (value: number): number => {
    // Walk outwards from the insertion point, taking the closest free
    // candidate inside the window.
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid]!.value < value) lo = mid + 1;
      else hi = mid;
    }
    let left = lo - 1;
    let right = lo;
    let best = -1;
    let bestDelta = Number.POSITIVE_INFINITY;
    for (;;) {
      const lDelta = left >= 0 ? value - sorted[left]!.value : Number.POSITIVE_INFINITY;
      const rDelta = right < sorted.length ? sorted[right]!.value - value : Number.POSITIVE_INFINITY;
      const delta = Math.min(lDelta, rDelta);
      if (delta > tol || delta === Number.POSITIVE_INFINITY) break;
      const pick = lDelta <= rDelta ? left-- : right++;
      const cand = sorted[pick]!;
      if (taken.has(cand.pos)) continue;
      if (delta < bestDelta) {
        best = cand.pos;
        bestDelta = delta;
      }
      break; // outward walk means the first free candidate is already nearest
    }
    return best;
  };

  for (const entry of a) {
    let pos = takeExact(entry.value);
    if (pos === -1 && tol > 0) pos = takeNearest(entry.value);
    if (pos >= 0) {
      taken.add(pos);
      matches.push({ aRow: entry.row, bRow: b[pos]!.row, amountCents: b[pos]!.value });
    } else {
      unmatchedA.push(entry.row);
    }
  }

  const unmatchedB: number[] = [];
  b.forEach((entry, pos) => {
    if (!taken.has(pos)) unmatchedB.push(entry.row);
  });

  return { matches, unmatchedA, unmatchedB };
}

/**
 * Positional convenience wrapper: treats each array position as its own row.
 * Prefer matchIndexed when the amounts came from a sheet, so that unparseable
 * cells do not silently renumber everything below them.
 */
export function matchTransactions(
  aAmounts: Array<number>,
  bAmounts: Array<number>,
  opts: { amountToleranceCents?: number; dateWindowMs?: number } = {},
): { matches: Match[]; unmatchedA: number[]; unmatchedB: number[] } {
  return matchIndexed(
    aAmounts.map((value, row) => ({ value, row })),
    bAmounts.map((value, row) => ({ value, row })),
    opts,
  );
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