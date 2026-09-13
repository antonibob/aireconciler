import { describe, it, expect } from "vitest";
import { reconcileTwoColumns } from "../src/taskpane/reconcile.js";
import { matchIndexed } from "../src/engine/recon_math.js";

describe("matchIndexed", () => {
  it("reports the caller's row numbers, not array positions", () => {
    const a = [{ value: 100, row: 7 }, { value: 250, row: 9 }];
    const b = [{ value: 100, row: 4 }];
    const { matches, unmatchedA, unmatchedB } = matchIndexed(a, b);
    expect(matches).toEqual([{ aRow: 7, bRow: 4, amountCents: 100 }]);
    expect(unmatchedA).toEqual([9]);
    expect(unmatchedB).toEqual([]);
  });

  it("pairs repeated amounts deterministically, in row order", () => {
    // Three identical amounts is routine in AP; the pairing must be stable.
    const a = [{ value: 500, row: 1 }, { value: 500, row: 2 }];
    const b = [{ value: 500, row: 10 }, { value: 500, row: 11 }, { value: 500, row: 12 }];
    const { matches, unmatchedB } = matchIndexed(a, b);
    expect(matches.map((m) => [m.aRow, m.bRow])).toEqual([[1, 10], [2, 11]]);
    expect(unmatchedB).toEqual([12]);
  });

  it("never reuses a bank row for two GL rows", () => {
    const a = [{ value: 100, row: 1 }, { value: 100, row: 2 }];
    const b = [{ value: 100, row: 5 }];
    const { matches, unmatchedA } = matchIndexed(a, b);
    expect(matches).toHaveLength(1);
    expect(unmatchedA).toEqual([2]);
  });

  it("falls back to the nearest candidate inside the tolerance", () => {
    const a = [{ value: 1000, row: 1 }];
    const b = [{ value: 1050, row: 5 }, { value: 1002, row: 6 }];
    const { matches } = matchIndexed(a, b, { amountToleranceCents: 100 });
    expect(matches[0]?.bRow).toBe(6); // 1002 is nearer than 1050
  });

  it("prefers an exact match over a nearer-in-order tolerance candidate", () => {
    const a = [{ value: 1000, row: 1 }];
    const b = [{ value: 1001, row: 5 }, { value: 1000, row: 6 }];
    const { matches } = matchIndexed(a, b, { amountToleranceCents: 50 });
    expect(matches[0]?.bRow).toBe(6);
  });

  it("handles a large ledger without quadratic blow-up", () => {
    const n = 20000;
    const a = Array.from({ length: n }, (_, i) => ({ value: i, row: i }));
    const b = Array.from({ length: n }, (_, i) => ({ value: n - 1 - i, row: i }));
    const started = Date.now();
    const { matches } = matchIndexed(a, b);
    expect(matches).toHaveLength(n);
    // The old O(n*m) scan needed ~400M comparisons for this; bucketing is instant.
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe("reconcileTwoColumns provenance", () => {
  const rows = (extra: Array<Array<string | number>> = []) => [
    ["GL", "Bank"],
    [100, 100],
    ["oops", 250],
    [300, 300],
    ...extra,
  ];

  it("keeps row numbers true when a cell above is unparseable", () => {
    const res = reconcileTwoColumns(rows(), 0, 1);
    // "oops" sits at index 2; the bank 250 beneath it must still report row 2,
    // not shift up because the GL side lost an entry.
    expect(res.unmatchedB).toEqual([2]);
    expect(res.parseFailures).toEqual([{ row: 2, side: "A", raw: "oops" }]);
    expect(res.matches.map((m) => m.aRow)).toEqual([1, 3]);
  });

  it("does not count blank cells as parse failures", () => {
    const res = reconcileTwoColumns(
      [["GL", "Bank"], [100, 100], ["", ""]],
      0,
      1,
    );
    expect(res.parseFailures).toEqual([]);
  });

  it("excludes unreadable cells from the totals and says so", () => {
    const res = reconcileTwoColumns(rows(), 0, 1);
    expect(res.sumACents).toBe(40000); // 100.00 + 300.00, "oops" excluded
    expect(res.text).toMatch(/could not be read/);
  });

  it("does not eat the first row when the range has no header", () => {
    const res = reconcileTwoColumns([[100, 100], [200, 200]], 0, 1);
    expect(res.headerRow).toBe(-1);
    expect(res.matchedPairs).toBe(2);
    expect(res.matches[0]?.aRow).toBe(0);
  });

  it("reports a nil residual when the two sides agree", () => {
    const res = reconcileTwoColumns([["GL", "Bank"], [100, 100]], 0, 1);
    expect(res.residualCents).toBe(0);
    expect(res.text).toMatch(/nil/);
    expect(res.likelyTransposition).toBe(false);
  });

  it("flags a transposition signature", () => {
    // 540 vs 450 differs by 90, divisible by 9.
    const res = reconcileTwoColumns([["GL", "Bank"], [5.4, 4.5]], 0, 1);
    expect(res.likelyTransposition).toBe(true);
    expect(res.text).toMatch(/transposed/);
  });

  it("parses messy accounting amounts on both sides", () => {
    const res = reconcileTwoColumns(
      [
        ["GL", "Bank"],
        ["(75.00)", "-75.00"],
        ["$1,250.00", "1250.00"],
      ],
      0,
      1,
    );
    expect(res.matchedPairs).toBe(2);
    expect(res.residualCents).toBe(0);
  });
});
