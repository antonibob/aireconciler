import { describe, it, expect } from "vitest";
import {
  parseAmount,
  detectHeaderRow,
  matchTransactions,
  explainDifference,
  isLikelyTransposition,
  findDuplicates,
} from "../src/engine/index.js";

describe("parseAmount — filthy exports", () => {
  it("handles plain numbers", () => {
    expect(parseAmount(123.45)).toEqual({ cents: 12345, ok: true });
    expect(parseAmount(0)).toEqual({ cents: 0, ok: true });
    expect(parseAmount(-12.5)).toEqual({ cents: -1250, ok: true });
  });

  it("handles text-stored numbers", () => {
    expect(parseAmount("45.00")).toEqual({ cents: 4500, ok: true });
    expect(parseAmount(" 99.99 ")).toEqual({ cents: 9999, ok: true });
  });

  it("handles parenthesized negatives (accounting)", () => {
    expect(parseAmount("(123.45)")).toEqual({ cents: -12345, ok: true });
    expect(parseAmount("( 45.00 )")).toEqual({ cents: -4500, ok: true });
    expect(parseAmount("(1,234.56)")).toEqual({ cents: -123456, ok: true });
  });

  it("handles thousands separators", () => {
    expect(parseAmount("1,234.56")).toEqual({ cents: 123456, ok: true });
    expect(parseAmount("12,345,678.90")).toEqual({ cents: 1234567890, ok: true });
  });

  it("handles European decimal comma", () => {
    expect(parseAmount("1.234,56")).toEqual({ cents: 123456, ok: true });
    expect(parseAmount("1 234,56")).toEqual({ cents: 123456, ok: true });
    expect(parseAmount("45,00")).toEqual({ cents: 4500, ok: true });
  });

  it("handles currency symbols and codes", () => {
    expect(parseAmount("$45.00")).toEqual({ cents: 4500, ok: true });
    expect(parseAmount("CAD 45.00")).toEqual({ cents: 4500, ok: true });
    expect(parseAmount("USD 1,234.56")).toEqual({ cents: 123456, ok: true });
    expect(parseAmount("€ 45,00")).toEqual({ cents: 4500, ok: true });
  });

  it("handles DR/CR suffixes and prefixes", () => {
    expect(parseAmount("45.00 DR")).toEqual({ cents: 4500, ok: true });
    expect(parseAmount("45.00 CR")).toEqual({ cents: -4500, ok: true });
    expect(parseAmount("CR 45.00")).toEqual({ cents: -4500, ok: true });
  });

  it("handles thin/narrow spaces", () => {
    expect(parseAmount("1\u202f234,56")).toEqual({ cents: 123456, ok: true });
    expect(parseAmount("1\u00a0234,56")).toEqual({ cents: 123456, ok: true });
  });

  it("returns ok:false rather than guessing on garbage", () => {
    expect(parseAmount("")).toEqual({ cents: 0, ok: false });
    expect(parseAmount("abc")).toEqual({ cents: 0, ok: false });
    expect(parseAmount("*")).toEqual({ cents: 0, ok: false });
    expect(parseAmount(null)).toEqual({ cents: 0, ok: false });
    expect(parseAmount(undefined)).toEqual({ cents: 0, ok: false });
  });
});

describe("detectHeaderRow", () => {
  it("finds a text header when data follows", () => {
    const rows = [
      ["invoice", "vendor", "amount"],
      [1, "Acme", 100],
      [2, "Beta", 200],
    ];
    expect(detectHeaderRow(rows)).toBe(0);
  });

  it("skips a title row and finds the real header", () => {
    const rows = [
      ["Company Monthly Report"], // title
      ["invoice_id", "vendor", "amount"], // header
      [1, "Acme", 100],
    ];
    expect(detectHeaderRow(rows)).toBe(1);
  });
});

describe("matchTransactions", () => {
  it("matches exact one-to-one", () => {
    const { matches, unmatchedA, unmatchedB } = matchTransactions([100, 200, 300], [300, 200, 100]);
    expect(matches.length).toBe(3);
    expect(unmatchedA).toHaveLength(0);
    expect(unmatchedB).toHaveLength(0);
  });

  it("matches within tolerance when no exact", () => {
    const { matches, unmatchedA, unmatchedB } = matchTransactions([100], [101], { amountToleranceCents: 2 });
    expect(matches.length).toBe(1);
    expect(matches[0]?.amountCents).toBe(101);
    expect(unmatchedA).toHaveLength(0);
    expect(unmatchedB).toHaveLength(0);
  });

  it("reports unmatched on both sides with provenance", () => {
    const { matches, unmatchedA, unmatchedB } = matchTransactions([100, 999], [100, 200]);
    expect(matches.length).toBe(1);
    expect(matches[0]?.aRow).toBe(0);
    expect(matches[0]?.bRow).toBe(0);
    expect(unmatchedA).toEqual([1]);
    expect(unmatchedB).toEqual([1]);
  });
});

describe("explainDifference + transposition", () => {
  it("returns the residual (book - bank)", () => {
    expect(explainDifference(5000, 4700)).toBe(300);
  });

  it("flags likely transpositions by divisibility by 9", () => {
    expect(isLikelyTransposition(54)).toBe(true); // 54 = 9*6
    expect(isLikelyTransposition(72)).toBe(true);
    expect(isLikelyTransposition(50)).toBe(false);
    expect(isLikelyTransposition(0)).toBe(false);
  });
});

describe("findDuplicates", () => {
  it("flags same vendor + same amount within window", () => {
    const rows = [
      { vendor: "Acme", amountCents: 15000, date: "2026-08-01" },
      { vendor: "Acme", amountCents: 15000, date: "2026-08-03" },
      { vendor: "Acme", amountCents: 15000, date: "2026-08-20" }, // outside window
    ];
    const dups = findDuplicates(rows, { dateWindowDays: 5 });
    expect(dups.length).toBe(1);
    expect(dups[0]?.a).toBe(0);
    expect(dups[0]?.b).toBe(1);
  });

  it("does not flag different amounts even if vendor+date match", () => {
    const rows = [
      { vendor: "Acme", amountCents: 15000, date: "2026-08-01" },
      { vendor: "Acme", amountCents: 6000, date: "2026-08-01" },
    ];
    expect(findDuplicates(rows)).toHaveLength(0);
  });
});