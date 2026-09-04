/**
 * Demo dataset — realistic Talius-style credit-card month. Lets the taskpane
 * run fully in a plain browser (no Office host) so the UI is testable and the
 * README can show a live screenshot. The real taskpane swaps this for
 * readTransactions(Excel range) via src/office.
 */

import {
  Transaction,
  StatementTotal,
  normalizeVendor,
  SUSPENSE_GL,
} from "../engine/index.js";

export const GL_ACCOUNTS = [
  { code: "7012-10", label: "Marketing & SEO" },
  { code: "7015-10", label: "Merchandise" },
  { code: "7017-10", label: "Trade Shows" },
  { code: "7018-10", label: "Dealers Training" },
  { code: "7037-10", label: "Travel" },
  { code: "7065-10", label: "Subscriptions" },
  { code: "7135-10", label: "Meals & Entertainment" },
  { code: "7137-10", label: "Airfare" },
  { code: "7160-10", label: "Interest" },
];

export const DEMO_TRANSACTIONS: Transaction[] = [
  { date: "2026-08-03", description: "AIR CANADA YVR-YYZ 08/15", amountCents: 25000, last4: "0807" },
  { date: "2026-08-03", description: "SHAW INTERNET VANCOUVER", amountCents: 7500, last4: "0807" },
  { date: "2026-08-05", description: "AMZN MKTP *2K9X1", amountCents: 4000, last4: "3474" },
  { date: "2026-08-06", description: "META ADS PLATFORMS", amountCents: 15000, last4: "9494" },
  { date: "2026-08-09", description: "UBER TRIP 08/07", amountCents: 2250, last4: "7878" },
  { date: "2026-08-11", description: "MYSTERY CHARGE DUBLIN LTD", amountCents: 1850, last4: "3474" },
  { date: "2026-08-12", description: "ADOBE CC - CREATIVE", amountCents: 6000, last4: "9583" },
  { date: "2026-08-15", description: "EXPEDIA REFUND 129.00", amountCents: -12900, last4: "0807" },
  { date: "2026-08-18", description: "TD CANADA TRUST PAYMENT", amountCents: 0, last4: "0807" },
  { date: "2026-08-21", description: "DOORDASH *VAN", amountCents: 4500, last4: "9583" },
  { date: "2026-08-24", description: "ANTHROPIC API 20.00 USD", amountCents: 2000, last4: "2169" },
];

/** Per-card statement net charges matching the raw sums above. */
export const DEMO_STATEMENT_TOTALS: StatementTotal[] = [
  { last4: "0807", netCents: 19600 }, // 250 + 75 − 129 (placeholder $0 excluded from sum)
  { last4: "3474", netCents: 5850 }, // 40 + 18.50
  { last4: "9494", netCents: 15000 },
  { last4: "9583", netCents: 10500 }, // 60 + 45
  { last4: "7878", netCents: 2250 },
  { last4: "2169", netCents: 2000 },
];

/** Prior 4 months of GST per vendor (normalized). Only true recurring, CAD,
 * GST-eligible vendors get claimed. */
export const DEMO_GST_HISTORY: Array<Map<string, boolean>> = [
  new Map([["shaw internet vancouver", true], ["adobe cc", true], ["anthropic", false]]),
  new Map([["shaw internet vancouver", true], ["adobe cc", true], ["anthropic", false]]),
  new Map([["shaw internet vancouver", true], ["adobe cc", true], ["anthropic", false]]),
  new Map([["shaw internet vancouver", true], ["adobe cc", true], ["anthropic", false]]),
];

/** Demo coding mapping — resembles what the LLM would draft; unknown => Suspense. */
export function demoCode(tx: Transaction): string {
  const v = normalizeVendor(tx.description);
  if (v.includes("air canada")) return "7137-10";
  if (v.includes("meta ads")) return "7012-10";
  if (v.includes("amazon") || v.includes("amzn")) return "7013-10";
  if (v.includes("adobe")) return "7065-10";
  if (v.includes("openai") || v.includes("anthropic")) return "7065-10";
  if (v.includes("shaw")) return "7065-10";
  if (v.includes("uber") || v.includes("doordash")) return "7135-10";
  return SUSPENSE_GL;
}