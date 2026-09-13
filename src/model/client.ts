/**
 * OpenRouter chat client with tool calling and streaming.
 *
 * Bring-your-own-key stays the whole point: every request here goes to the
 * user's own OpenRouter account with the key they pasted into settings. We add
 * no proxy and no vendor of our own. Tool calling is plain OpenAI-compatible
 * function calling, which OpenRouter accepts verbatim, so the user's existing
 * key and credits work unchanged.
 */

import type { ToolCall, ToolSchema } from "./tools.js";

export const DEFAULT_BASE = "https://openrouter.ai/api/v1";

export interface ClientConfig {
  /** The user's own OpenRouter key. Never ours, never pooled. */
  apiKey: string;
  model: string;
  baseUrl?: string;
  /** Aborts an in-flight request when the user hits Stop. */
  signal?: AbortSignal;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** Present on assistant turns that requested tools. */
  toolCalls?: ToolCall[];
  /** Present on tool-result turns; ties the result to its call. */
  toolCallId?: string;
}

export interface ChatTurn {
  content: string;
  toolCalls: ToolCall[];
  ok: boolean;
  /** Cost in USD for this call, when OpenRouter reports it. */
  cost?: number;
  /** Populated when ok is false. */
  error?: string;
}

/** Wire format sent to OpenRouter. Kept separate from our internal shape. */
interface WireMessage {
  role: string;
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

function toWire(m: ChatMessage): WireMessage {
  if (m.role === "tool") {
    return { role: "tool", content: m.content, tool_call_id: m.toolCallId };
  }
  if (m.role === "assistant" && m.toolCalls?.length) {
    return {
      role: "assistant",
      // OpenRouter wants null, not "", when the turn is purely tool calls.
      content: m.content || null,
      tool_calls: m.toolCalls.map((c) => ({
        id: c.id,
        type: "function" as const,
        function: { name: c.name, arguments: JSON.stringify(c.args) },
      })),
    };
  }
  return { role: m.role, content: m.content };
}

function headers(cfg: ClientConfig): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${cfg.apiKey}`,
    // OpenRouter uses these for its app leaderboard; they are not auth.
    "HTTP-Referer": "https://github.com/antonibob/aireconciler",
    "X-Title": "AI Closer",
  };
}

/** OpenRouter reports spend differently across models; take whichever it sent. */
function readCost(usage: unknown): number | undefined {
  if (!usage || typeof usage !== "object") return undefined;
  const u = usage as Record<string, unknown>;
  if (typeof u.cost === "number") return u.cost;
  if (typeof u.prompt_cost === "number" && typeof u.completion_cost === "number") {
    return u.prompt_cost + u.completion_cost;
  }
  return undefined;
}

/** Turn an error body into something worth showing an accountant. */
export function explainHttpError(status: number, body: string): string {
  const snippet = body.slice(0, 400);
  if (status === 401) return "OpenRouter rejected the API key. Check it in settings.";
  if (status === 402) return "Your OpenRouter account is out of credit.";
  if (status === 429) return "OpenRouter is rate-limiting this key. Wait a moment and retry.";
  if (status === 404) {
    return `OpenRouter does not recognise that model id. Pick another in settings. (${snippet})`;
  }
  return `OpenRouter returned HTTP ${status}: ${snippet}`;
}

/**
 * One non-streaming turn. Returns the assistant text and any tool calls it
 * asked for; the caller executes those and sends the results back.
 */
export async function chatWithTools(
  messages: ChatMessage[],
  tools: ToolSchema[],
  cfg: ClientConfig,
): Promise<ChatTurn> {
  if (!cfg.apiKey) {
    return { content: "", toolCalls: [], ok: false, error: "No OpenRouter API key set. Open settings and paste your key." };
  }
  const body = {
    model: cfg.model,
    messages: messages.map(toWire),
    tools: tools.length ? tools : undefined,
    tool_choice: tools.length ? "auto" : undefined,
    temperature: 0,
    usage: { include: true },
  };
  try {
    const res = await fetch(`${cfg.baseUrl ?? DEFAULT_BASE}/chat/completions`, {
      method: "POST",
      headers: headers(cfg),
      body: JSON.stringify(body),
      signal: cfg.signal,
    });
    if (!res.ok) {
      return { content: "", toolCalls: [], ok: false, error: explainHttpError(res.status, await res.text()) };
    }
    const data = await res.json();
    const msg = data?.choices?.[0]?.message;
    return {
      content: (msg?.content ?? "").trim(),
      toolCalls: parseToolCalls(msg?.tool_calls),
      ok: true,
      cost: readCost(data?.usage),
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { content: "", toolCalls: [], ok: false, error: "Stopped." };
    }
    return {
      content: "",
      toolCalls: [],
      ok: false,
      error: `Could not reach OpenRouter: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Normalise the wire tool_calls array into our ToolCall shape. */
export function parseToolCalls(raw: unknown): ToolCall[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((c, i): ToolCall => {
    const fn = (c as { function?: { name?: string; arguments?: string } })?.function;
    const id = (c as { id?: string })?.id ?? `call_${i}`;
    const name = fn?.name ?? "";
    const rawArgs = fn?.arguments ?? "";
    if (!rawArgs.trim()) return { id, name, args: {} };
    try {
      const parsed = JSON.parse(rawArgs);
      // A model can legally emit a non-object here; treat that as a failure
      // rather than letting it reach a tool that expects named arguments.
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { id, name, args: {}, parseError: `Arguments were not a JSON object: ${rawArgs.slice(0, 200)}` };
      }
      return { id, name, args: parsed as Record<string, unknown> };
    } catch {
      return { id, name, args: {}, parseError: `Arguments were not valid JSON: ${rawArgs.slice(0, 200)}` };
    }
  });
}

/** Accumulator for streamed tool-call fragments, keyed by their wire index. */
interface PartialCall {
  id: string;
  name: string;
  args: string;
}

/**
 * Apply one streamed delta to the accumulators. Exported for testing: the
 * fragment interleaving here is the fiddliest part of the client, and it is
 * not something we can exercise against a live model in CI.
 */
export function applyDelta(
  delta: unknown,
  textSoFar: string,
  calls: Map<number, PartialCall>,
): string {
  const d = delta as {
    content?: string | null;
    tool_calls?: Array<{
      index?: number;
      id?: string;
      function?: { name?: string; arguments?: string };
    }>;
  } | null;
  if (!d) return textSoFar;
  let text = textSoFar;
  if (typeof d.content === "string") text += d.content;
  for (const tc of d.tool_calls ?? []) {
    const idx = tc.index ?? 0;
    const cur = calls.get(idx) ?? { id: "", name: "", args: "" };
    // id and name arrive once, near the start; arguments stream in fragments.
    if (tc.id) cur.id = tc.id;
    if (tc.function?.name) cur.name = tc.function.name;
    if (tc.function?.arguments) cur.args += tc.function.arguments;
    calls.set(idx, cur);
  }
  return text;
}

/** Rebuild ToolCalls from the streaming accumulators. */
export function finalizeCalls(calls: Map<number, PartialCall>): ToolCall[] {
  return [...calls.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([i, c]) =>
      parseToolCalls([
        { id: c.id || `call_${i}`, function: { name: c.name, arguments: c.args } },
      ])[0]!,
    );
}

/**
 * Streaming turn. Calls onText with each text fragment as it arrives so the
 * pane can render progressively; tool calls are accumulated and returned whole,
 * because a half-parsed call is not something we can act on.
 */
export async function streamWithTools(
  messages: ChatMessage[],
  tools: ToolSchema[],
  cfg: ClientConfig,
  onText: (chunk: string) => void,
): Promise<ChatTurn> {
  if (!cfg.apiKey) {
    return { content: "", toolCalls: [], ok: false, error: "No OpenRouter API key set. Open settings and paste your key." };
  }
  const body = {
    model: cfg.model,
    messages: messages.map(toWire),
    tools: tools.length ? tools : undefined,
    tool_choice: tools.length ? "auto" : undefined,
    temperature: 0,
    stream: true,
    usage: { include: true },
  };
  try {
    const res = await fetch(`${cfg.baseUrl ?? DEFAULT_BASE}/chat/completions`, {
      method: "POST",
      headers: headers(cfg),
      body: JSON.stringify(body),
      signal: cfg.signal,
    });
    if (!res.ok) {
      return { content: "", toolCalls: [], ok: false, error: explainHttpError(res.status, await res.text()) };
    }
    if (!res.body) {
      return { content: "", toolCalls: [], ok: false, error: "OpenRouter returned an empty stream." };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const calls = new Map<number, PartialCall>();
    let text = "";
    let cost: number | undefined;
    let buffer = "";

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE frames are newline-delimited; the tail may be a partial line.
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(payload);
        } catch {
          continue; // OpenRouter interleaves comment/keepalive frames.
        }
        const p = parsed as { choices?: Array<{ delta?: unknown }>; usage?: unknown };
        const before = text;
        text = applyDelta(p.choices?.[0]?.delta, text, calls);
        if (text.length > before.length) onText(text.slice(before.length));
        const c = readCost(p.usage);
        if (c !== undefined) cost = c;
      }
    }

    return { content: text.trim(), toolCalls: finalizeCalls(calls), ok: true, cost };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { content: "", toolCalls: [], ok: false, error: "Stopped." };
    }
    return {
      content: "",
      toolCalls: [],
      ok: false,
      error: `Could not reach OpenRouter: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export interface ModelOption {
  id: string;
  name: string;
  /** Prompt price per token as reported by OpenRouter, for sorting by cost. */
  promptPrice: number;
  contextLength: number;
}

/**
 * Fetch the models this key can actually use, keeping only those that support
 * tool calling. Replaces the hardcoded preset list — a stale slug there means
 * every request 404s, which is indistinguishable from the add-in being broken.
 */
export async function fetchToolCapableModels(cfg: {
  apiKey?: string;
  baseUrl?: string;
  signal?: AbortSignal;
}): Promise<{ models: ModelOption[]; ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${cfg.baseUrl ?? DEFAULT_BASE}/models`, {
      // The catalogue is public; the key only personalises availability.
      headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {},
      signal: cfg.signal,
    });
    if (!res.ok) {
      return { models: [], ok: false, error: explainHttpError(res.status, await res.text()) };
    }
    const data = await res.json();
    return { models: selectToolCapable(data?.data), ok: true };
  } catch (err) {
    return {
      models: [],
      ok: false,
      error: `Could not load the model list: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Pure half of fetchToolCapableModels, so the filtering is testable. */
export function selectToolCapable(raw: unknown): ModelOption[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m) => {
      const params = (m as { supported_parameters?: unknown })?.supported_parameters;
      return Array.isArray(params) && params.includes("tools");
    })
    .map((m): ModelOption => {
      const row = m as {
        id?: string;
        name?: string;
        context_length?: number;
        pricing?: { prompt?: string | number };
      };
      const price = Number(row.pricing?.prompt ?? Number.NaN);
      return {
        id: row.id ?? "",
        name: row.name ?? row.id ?? "",
        promptPrice: Number.isFinite(price) ? price : Number.POSITIVE_INFINITY,
        contextLength: row.context_length ?? 0,
      };
    })
    .filter((m) => m.id !== "")
    .sort((a, b) => a.promptPrice - b.promptPrice || a.id.localeCompare(b.id));
}
