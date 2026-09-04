import type { Cents, GstHistory } from "./types.js";

/**
 * GST treatment on the Talius cards follows a company convention, not generic
 * tax law: charge GST ONLY for vendors whose treatment has been CONSISTENT
 * for at least 4 consecutive months. One-off restaurants, transport (Uber),
 * flights, hotels, first-time vendors, and essentially all foreign/US vendors
 * get NO GST — regardless of conventional taxability.
 *
 * The engine computes the deterministic part (normalize vendor, count months,
 * apply the threshold). The LLM layer is asked only for the ambiguous
 * same-vendor judgments, and its output must go through this gate.
 */

/** Min consecutive months of identical treatment to trust a vendor's GST. */
export const CONSISTENCY_MONTHS = 4;

const CURRENCY_AMOUNT_RE = /\d+\.\d+\s*(USD|EUR|GBP|CAD|INR|CNY|JPY)/i;
const CURRENCY_WORD_RE = /\b(USD|EUR|GBP|CAD|INR|CNY|JPY)\b/gi;
const DATE_RE = /\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s?\d{0,4}\b/i;
const NOISE_RE = /\*+/g;

/** Strip a raw statement description down to a stable vendor key, per the spec:
 * first 1–3 significant words, minus dates, currency markers, `*`, and any
 * digit-bearing reference/amount tokens (2K9X1, REF09, 08/15, $52.00). */
export function normalizeVendor(description: string): string {
  const cleaned = description
    .replace(CURRENCY_AMOUNT_RE, " ")
    .replace(CURRENCY_WORD_RE, " ")
    .replace(DATE_RE, " ")
    .replace(NOISE_RE, "")
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return "(unnamed)";
  const words = cleaned
    .split(" ")
    .filter((w) => w.length > 0 && !/\d/.test(w)); // drop refs/amounts/dates
  return words.slice(0, 3).join(" ").toLowerCase() || "(unnamed)";
}

/**
 * A vendor passes the consistency test if it appears in >= 4 distinct prior
 * months AND every one of those months has the SAME treatment (all GST or all
 * no-GST). Any contradictory month fails the vendor.
 */
export function gstConsistent(
  vendor: string,
  history: GstHistory,
  months: number = CONSISTENCY_MONTHS,
): boolean {
  const rec = history.get(vendor);
  if (!rec || rec.length < months) return false;
  const first = rec[0];
  return rec.every((v) => v === first);
}

/**
 * Build a GstHistory from prior months' { normalizedVendor -> hadGst } maps.
 */
export function buildGstHistory(
  monthHistory: Array<Map<string, boolean>>,
): GstHistory {
  const out = new Map<string, boolean[]>();
  for (const month of monthHistory) {
    for (const [vendor, hadGst] of month) {
      const rec = out.get(vendor);
      if (rec) rec.push(hadGst);
      else out.set(vendor, [hadGst]);
    }
  }
  return out;
}

/** GST claim on a gross amount that INCLUDES tax: gross * 5/105, rounded. */
export function gstFromGross(grossCents: Cents): Cents {
  const cents = Math.round((grossCents * 5) / 105);
  return cents;
}

/** Helper: cents -> "$1,234.56" string for display. */
export function formatCents(cents: Cents): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rest = abs % 100;
  return `${sign}$${dollars.toLocaleString("en-US")}.${String(rest).padStart(2, "0")}`;
}