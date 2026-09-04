/**
 * Recco engine — the deterministic heart of the add-in.
 * Pure TypeScript, no Office/network/React dependencies, fully unit-tested.
 *
 * Design rule (from the Talius CC recon spec): the engine FLAGS and DRAFTS but
 * never silently balances. A suspicious row goes to Suspense or is flagged for
 * review — it is never quietly netted away.
 *
 * Money is represented as integer cents throughout to avoid float drift in
 * variance checks. All math is exact.
 */

export type Cents = number;

/** A raw credit-card transaction from a CSV export. */
export interface Transaction {
  /** Statement date, e.g. "2026-08-03". */
  date: string;
  /** Vendor/description as it appears on the statement. */
  description: string;
  /** Signed amount in CAD cents. Charges positive, credits/refunds negative. */
  amountCents: Cents;
  /** Card last-4, e.g. "0807". Assigns the row to a cardholder. */
  last4: string;
}

/** Which real person owns a card. */
export interface CardEntry {
  last4: string;
  holder: string;
}

/** Statement summary for one card (from the statement's `Total for 4500 XXXX XXXX ####`). */
export interface StatementTotal {
  last4: string;
  /** Net charges = Purchases − Other credits, in cents. */
  netCents: Cents;
}

/** Prior-month GST treatment for a single vendor: month -> had GST? Key: normalized vendor. */
export type GstHistory = Map<string, boolean[]>;

/** A GL coding target column the user can code transactions into. */
export interface GlAccount {
  code: string;
  /** Human label shown in the taskpane, e.g. "Marketing & SEO". */
  label: string;
}

export type FlagKind =
  | "sum-tie-out" // per-card CSV sum != statement total
  | "credit" // CSV sum exceeds statement total → likely a refund to count in Other credits
  | "suspense" // row is ambiguous or uncodable → park in Suspense, don't guess
  | "check-uneven" // Amount − SUM(coded) != 0 → cross-foot broke
  | "gst-needs-evidence" // GST charged but vendor lacks 4-month consistency
  | "gst-missing" // likely-GST vendor but no GST coded
  | "duplicate";

export type FlagSeverity = "info" | "warn" | "error";

export interface Flag {
  kind: FlagKind;
  severity: FlagSeverity;
  last4?: string;
  description?: string;
  amountCents?: Cents;
  message: string;
}

/** One coded row: the transaction and the GL column it nets to. */
export interface CodedRow {
  transaction: Transaction;
  /** GL code this row nets to (may be a suspense account). */
  glCode: string;
  /** GST (5% inclusive) claimed for this row, if any. */
  gstCents: Cents;
  /** Amount − GST − SUM(all coded nets except suspense). */
  checkCents: Cents;
  holder: string;
}

/** Per-card summary compared against the statement. */
export interface CardTieOut {
  last4: string;
  holder: string;
  rawSumCents: Cents;
  statementNetCents: Cents;
  /** rawSum − statementNet. Nonzero → flag. Positive → a credit to count. */
  deltaCents: Cents;
}

export interface ReconResult {
  rows: CodedRow[];
  cardTieOuts: CardTieOut[];
  flags: Flag[];
  /** grand net charges across all cards. */
  netChargesCents: Cents;
  /** sum of coded transaction amounts. */
  codedSumCents: Cents;
  /** Amount Due − coded. Must be 0 to pass (statementAmountDue passed in). */
  varianceCents: Cents;
  passed: boolean;
}