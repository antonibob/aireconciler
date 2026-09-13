/** GL coding suggestions — the one place the model is asked for judgment.
 *
 * Keep the model surface NARROW. The engine does all deterministic math and
 * enforcement (GST gate, check cross-foot, variance). The model is only asked
 * for judgment that lives outside the rules — normalize an ambiguous vendor,
 * suggest a GL code. Its answers are DRAFTS the accountant confirms; the engine
 * re-validates whatever comes back.
 *
 * The general chat path lives in client.ts + the agent loop; it is not here.
 */

import { chatWithTools, type ClientConfig } from "./client.js";
import type { Transaction } from "../engine/index.js";

export const DEFAULT_MODEL = "anthropic/claude-3.5-sonnet";

export interface GlSuggestion {
  transaction: Transaction;
  glCode: string | null;
  confidence: "high" | "low";
  reason: string;
}

const SYSTEM = `You are a careful accounting assistant embedded in an Excel add-in.
You produce DRAFT journal coding suggestions. You never post anything yourself.
Follow these rules exactly:
- Return ONLY valid JSON. No markdown fences, no prose.
- Shape: {"codes": [{"glCode": string|null, "confidence": "high"|"low", "reason": string}]}
- One entry per input transaction, in the same order. Never reorder or omit.
- For a vendor you cannot confidently code, return glCode null and confidence "low".
- Never invent a GL account that is not in the provided mapping.
- Flag uncertainty explicitly in "reason". Do not silently balance.`;

/** Ask OpenRouter for GL code suggestions for a batch of uncoded rows. */
export async function suggestGlCodes(
  rows: Transaction[],
  glAccounts: Array<{ code: string; label: string }>,
  cfg: ClientConfig,
): Promise<GlSuggestion[]> {
  const unresolved = (reason: string) =>
    rows.map((r) => ({ transaction: r, glCode: null, confidence: "low" as const, reason }));

  if (rows.length === 0) return [];

  const accounts = glAccounts.map((a) => `${a.code} ${a.label}`).join("\n");
  const lines = rows
    .map((r, i) => `${i}: ${r.date} | ${r.description} | ${(r.amountCents / 100).toFixed(2)} | ${r.last4}`)
    .join("\n");

  const turn = await chatWithTools(
    [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: `Available GL accounts:\n${accounts}\n\nCode each transaction below. Return ${rows.length} entries in "codes", in input order.\n\nTransactions:\n${lines}`,
      },
    ],
    [], // no tools: this is a single structured answer, not an agent turn
    cfg,
  );

  // Fail loud: every row unresolved rather than guessing.
  if (!turn.ok) return unresolved(`Model call failed: ${turn.error ?? "unknown error"}`);

  const parsed = parseGlResponse(turn.content, rows.length);
  if (!parsed) return unresolved(`Could not parse model JSON: ${turn.content.slice(0, 200)}`);

  return rows.map((r, i) => {
    const c = parsed[i];
    return {
      transaction: r,
      glCode: c?.glCode ?? null,
      confidence: c?.confidence === "high" ? "high" : "low",
      reason: c?.reason ?? "Model returned no entry for this row.",
    };
  });
}

interface RawCode {
  glCode: string | null;
  confidence: "high" | "low";
  reason: string;
}

/**
 * Accept either {"codes": [...]} or a bare array — models drift between the two
 * regardless of what the prompt says, and a stricter parser here would silently
 * mark every row unresolved. Returns null when neither shape is present.
 */
export function parseGlResponse(content: string, expected: number): RawCode[] | null {
  const text = content.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    // Salvage the first JSON object or array embedded in prose.
    const m = /[{[][\s\S]*[}\]]/.exec(text);
    if (!m) return null;
    try {
      data = JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
  const arr = Array.isArray(data)
    ? data
    : Array.isArray((data as { codes?: unknown })?.codes)
      ? (data as { codes: unknown[] }).codes
      : null;
  if (!arr) return null;
  // A short reply is padded by the caller's index lookup; a long one is clipped.
  return arr.slice(0, expected).map((c): RawCode => {
    const row = c as Partial<RawCode>;
    return {
      glCode: typeof row?.glCode === "string" ? row.glCode : null,
      confidence: row?.confidence === "high" ? "high" : "low",
      reason: typeof row?.reason === "string" ? row.reason : "No reason given.",
    };
  });
}
