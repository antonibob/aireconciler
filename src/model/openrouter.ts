/** OpenRouter model layer — the "cheap, BYO-key" draft assistant.
 *
 * Keep the model surface NARROW. The engine does all deterministic math and
 * enforcement (GST gate, check cross-foot, variance). The model is only asked
 * for judgment that lives outside the rules — normalize an ambiguous vendor,
 * suggest a GL code, draft an audit note. Its answers are DRAFTS the accountant
 * confirms; the engine re-validates whatever comes back.
 */

import type { Transaction } from "../engine/index.js";

export interface ModelConfig {
  /** OpenRouter API key. Kept out of git; entered in the taskpane settings. */
  apiKey: string;
  /** Cheap model id. Defaults to a strong, low-cost coder. */
  model?: string;
  baseUrl?: string;
}

export const DEFAULT_MODEL = "deepseek/deepseek-v3-0724";
const DEFAULT_BASE = "https://openrouter.ai/api/v1";

export interface ChatResult {
  content: string;
  ok: boolean;
  /** OpenRouter usage cost in USD, when reported. */
  cost?: number;
}

export interface GlSuggestion {
  transaction: Transaction;
  glCode: string | null;
  confidence: "high" | "low";
  reason: string;
}

const SYSTEM = `You are a careful accounting assistant embedded in an Excel add-in.
You produce DRAFT journal coding suggestions. You never post anything yourself.
Follow these rules exactly:
- Return ONLY valid JSON matching the requested shape. No markdown fences, no prose.
- For a vendor you cannot confidently code, return glCode null and confidence "low".
- Never invent an amount or a GL account that is not part of a provided mapping.
- Flag uncertainty explicitly in "reason". Do not silently balance.`;

/** Ask OpenRouter for a GL code suggestion for a batch of uncoded rows. */
export async function suggestGlCodes(
  rows: Transaction[],
  glAccounts: Array<{ code: string; label: string }>,
  cfg: ModelConfig,
): Promise<GlSuggestion[]> {
  const body = {
    model: cfg.model ?? DEFAULT_MODEL,
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: `Given these GL accounts:\n${glAccounts
          .map((a) => `${a.code} ${a.label}`)
          .join("\n")}\n\nCode each transaction. Return a JSON array with one object per input, in order: {"glCode": string|null, "confidence": "high"|"low", "reason": string}.\n\nTransactions:\n${rows
          .map(
            (r, i) =>
              `${i}: ${r.date} | ${r.description} | ${(r.amountCents / 100).toFixed(2)} | ${r.last4}`,
          )
          .join("\n")}`,
      },
    ],
    temperature: 0,
    max_tokens: 1200,
    response_format: { type: "json_object" },
  };

  const res = await chat(body, cfg);
  if (!res.ok) {
    // Fail loud: every row unresolved rather than guessing.
    return rows.map((r) => ({
      transaction: r,
      glCode: null,
      confidence: "low" as const,
      reason: `Model call failed: ${res.content}`,
    }));
  }

  try {
    const parsed = JSON.parse(res.content).codes as Array<{
      glCode: string | null;
      confidence: "high" | "low";
      reason: string;
    }>;
    return rows.map((r, i) => {
      const c = parsed[i];
      return {
        transaction: r,
        glCode: c?.glCode ?? null,
        confidence: c?.confidence ?? "low",
        reason: c?.reason ?? "No reason given.",
      };
    });
  } catch {
    return rows.map((r) => ({
      transaction: r,
      glCode: null,
      confidence: "low" as const,
      reason: `Could not parse model JSON: ${res.content.slice(0, 200)}`,
    }));
  }
}

async function chat(
  body: unknown,
  cfg: ModelConfig,
): Promise<ChatResult> {
  if (!cfg.apiKey) {
    return { content: "No OpenRouter API key configured in the taskpane settings.", ok: false };
  }
  try {
    const base = cfg.baseUrl ?? DEFAULT_BASE;
    const response = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
        "HTTP-Referer": "https://github.com/antonio-clair/office-ai-closer",
        "X-Title": "Office AI Closer",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const err = await response.text();
      return { content: `HTTP ${response.status}: ${err.slice(0, 300)}`, ok: false };
    }
    const data = await response.json();
    const usage = data?.usage;
    const cost =
      usage &&
      typeof usage?.prompt_cost === "number" &&
      typeof usage?.completion_cost === "number"
        ? usage.prompt_cost + usage.completion_cost
        : undefined;
    return {
      content: (data?.choices?.[0]?.message?.content ?? "").trim(),
      ok: true,
      cost,
    };
  } catch (err) {
    return { content: `Network error: ${err instanceof Error ? err.message : String(err)}`, ok: false };
  }
}

/** ChatMessage used by the general chat pane. */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const CHAT_SYSTEM = `You are a helpful, concise assistant embedded in an Excel taskpane. You can see the user's spreadsheet context and can answer questions, write formulas, and help with accounting. Be direct, use plain text with light markdown, and don't over-apologize. If the user references a selected range, ask for its contents or note you can't see it directly.`;

/**
 * General-purpose chat completion used by the Claude-like taskpane chat.
 * Sends the full message history so the model keeps context within a session.
 */
export async function chatCompletion(
  messages: ChatMessage[],
  cfg: ModelConfig,
): Promise<ChatResult> {
  const body = {
    model: cfg.model ?? DEFAULT_MODEL,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    temperature: 0.4,
    max_tokens: 2048,
  };
  return chat(body, cfg);
}