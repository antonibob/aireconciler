import { describe, it, expect } from "vitest";
import {
  reconcile,
  SUSPENSE_GL,
  CC_CLEARING_GL,
  CardEntry,
  Transaction,
  StatementTotal,
  ReconConfig,
} from "../src/engine/index.js";
import {
  normalizeVendor,
  gstFromGross,
  gstConsistent,
  buildGstHistory,
  CONSISTENCY_MONTHS,
} from "../src/engine/index.js";

const tx = (
  date: string,
  description: string,
  amountDollars: number,
  last4: string,
): Transaction => ({ date, description, amountCents: Math.round(amountDollars * 100), last4 });

const st = (last4: string, netDollars: number): StatementTotal => ({
  last4,
  netCents: Math.round(netDollars * 100),
});

/** Every row codes to Travel unless told otherwise. */
const defaultCode = () => "7137-10";

function run(
  options: Partial<ReconConfig> & {
    transactions: Transaction[];
    statementTotals: StatementTotal[];
  },
) {
  return reconcile({
    gstHistoryMonths: [],
    statementAmountDueCents: 0,
    code: defaultCode,
    ...options,
  });
}

describe("normalizeVendor", () => {
  it("strips dates, currency, and noise to a stable key", () => {
    expect(normalizeVendor("EXPEDIA 08/15 USD $52.00 *REF*09")).toBe("expedia");
  });
  it("keeps first 3 significant words", () => {
    expect(normalizeVendor("SHAW CABLE VANCOUVER INTERNET")).toBe("shaw cable vancouver");
  });
});

describe("GST gate (4-month consistency)", () => {
  it("rejects a vendor without 4 months of history", () => {
    const rec = buildGstHistory([new Map([["shaw", true]])]);
    expect(gstConsistent("shaw", rec, CONSISTENCY_MONTHS)).toBe(false);
  });

  it("accepts a vendor with 4+ consistent months", () => {
    const rec = buildGstHistory([
      new Map([["shaw", true]]),
      new Map([["shaw", true]]),
      new Map([["shaw", true]]),
      new Map([["shaw", true]]),
    ]);
    expect(gstConsistent("shaw", rec, CONSISTENCY_MONTHS)).toBe(true);
  });

  it("rejects on any contradictory month", () => {
    const rec = buildGstHistory([
      new Map([["shaw", true]]),
      new Map([["shaw", true]]),
      new Map([["shaw", true]]),
      new Map([["shaw", false]]),
    ]);
    expect(gstConsistent("shaw", rec, CONSISTENCY_MONTHS)).toBe(false);
  });

  it("computes GST on a gross figure as gross*5/105", () => {
    expect(gstFromGross(10500)).toBe(500); // $105 gross -> $5 tax
  });
});

describe("reconcile — clean run passes", () => {
  it("nets to zero with matching per-card totals, no flags of error severity", () => {
    const res = run({
      transactions: [tx("2026-08-03", "AIR CANADA YVR-YYZ", 250.0, "0807")],
      statementTotals: [st("0807", 250.0)],
      statementAmountDueCents: 25000,
    });
    expect(res.passed).toBe(true);
    expect(res.varianceCents).toBe(0);
    const bad = res.flags.filter((f) => f.severity === "error");
    expect(bad).toHaveLength(0);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]!.holder).toBe("Cal");
    expect(res.rows[0]!.checkCents).toBe(0);
  });
});

describe("credit detection", () => {
  it("routes a negative amount to Other credits and flags it", () => {
    const res = run({
      transactions: [tx("2026-08-15", "EXPEDIA REFUND", -129.0, "0807")],
      statementTotals: [st("0807", -129.0)],
    });
    expect(res.rows[0]!.glCode).toBe(CC_CLEARING_GL);
    expect(res.rows[0]!.gstCents).toBe(0); // no GST on credits
    expect(res.flags.some((f) => f.kind === "credit")).toBe(true);
  });

  it("flags when the raw CSV sum exceeds the statement total (leftover credit)", () => {
    const res = run({
      transactions: [tx("2026-08-03", "AMZN MKTP", 40.0, "0807")],
      statementTotals: [st("0807", 35.0)], // statement says 35, CSV says 40
    });
    expect(res.flags.some((f) => f.kind === "sum-tie-out")).toBe(true);
    expect(res.cardTieOuts[0]!.deltaCents).toBe(500);
    expect(res.passed).toBe(false);
  });
});

describe("suspense routing", () => {
  it("sends an ambiguous row to Suspense and flags it, never guesses", () => {
    const res = run({
      transactions: [tx("2026-08-09", "MYSTERY CHARGE DUBLIN", 18.5, "2169")],
      statementTotals: [st("2169", 18.5)],
      code: () => SUSPENSE_GL,
    });
    expect(res.rows[0]!.glCode).toBe(SUSPENSE_GL);
    expect(res.flags.some((f) => f.kind === "suspense" && f.severity === "warn")).toBe(true);
  });
});

describe("placeholder rows", () => {
  it("skips $0.00 payment rows and does not code them", () => {
    const res = run({
      transactions: [
        tx("2026-08-01", "TD CANADA TRUST", 0.0, "0807"),
        tx("2026-08-03", "SHAW", 75.0, "0807"),
      ],
      statementTotals: [st("0807", 75.0)],
    });
    expect(res.rows).toHaveLength(1);
    expect(res.flags.some((f) => f.kind === "duplicate")).toBe(true);
  });
});

describe("check cross-foot", () => {
  it("parks a suspense row with a clean cross-foot (no false check-uneven)", () => {
    const res = run({
      transactions: [tx("2026-08-05", "META ADS", 50.0, "7878")],
      statementTotals: [st("7878", 50.0)],
      code: () => SUSPENSE_GL,
    });
    const uneven = res.flags.filter((f) => f.kind === "check-uneven");
    expect(uneven).toHaveLength(0);
    // Parked row is excluded from the coded sum entirely.
    expect(res.codedSumCents).toBe(0);
    expect(res.rows[0]!.glCode).toBe(SUSPENSE_GL);
  });
});