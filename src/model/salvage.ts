/**
 * Making weaker models behave like stronger ones.
 *
 * The pane has to work the same whether it is driven by a frontier model or by
 * DeepSeek or GLM. The gap between them is mostly *protocol*, not reasoning:
 * cheaper models understand perfectly well that they should read a range, then
 * announce it as text instead of emitting a tool call, or call `readRange`
 * instead of `read_range`, or pass `range` where the schema says `address`.
 *
 * Every one of those is recoverable, and recovering it here means the model
 * choice stops being the difference between working and broken. Nothing in this
 * file invents intent — it only re-reads an intent the model already expressed.
 */

import { TOOL_NAMES, type ToolCall } from "./tools.js";

/** Collapse a name to its letters and digits, so casing and separators stop mattering. */
function canonical(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const BY_CANONICAL = new Map(TOOL_NAMES.map((n) => [canonical(n), n]));

/**
 * Map whatever the model called the tool onto a real one.
 *
 * Models routinely emit `readRange`, `read-range`, `functions.read_range` or
 * `tool:read_range`. All of those name exactly one thing; rejecting them buys
 * nothing but a wasted round trip.
 */
export function normalizeToolName(raw: string): string | null {
  if (!raw) return null;
  // Strip a namespace prefix like "functions." or "tool:".
  const bare = raw.split(/[.:]/).pop() ?? raw;
  return BY_CANONICAL.get(canonical(bare)) ?? null;
}

/**
 * Argument aliases, per tool.
 *
 * These are the names models reach for when they do not copy the schema
 * exactly. Renaming is safe because the target parameter is unambiguous;
 * anything genuinely ambiguous is left alone for the tool to reject.
 */
const ALIASES: Record<string, Record<string, string>> = {
  read_range: { range: "address", cell: "address", ref: "address", a1: "address", rows: "maxRows", limit: "maxRows" },
  reconcile_columns: {
    range: "address",
    colA: "columnA",
    colB: "columnB",
    col_a: "columnA",
    col_b: "columnB",
    column_a: "columnA",
    column_b: "columnB",
    glColumn: "columnA",
    bankColumn: "columnB",
    tolerance: "toleranceCents",
  },
  find_duplicates: {
    range: "address",
    vendor: "vendorColumn",
    amount: "amountColumn",
    date: "dateColumn",
    vendor_column: "vendorColumn",
    amount_column: "amountColumn",
    date_column: "dateColumn",
    window: "dateWindowDays",
  },
  propose_write: { range: "address", cell: "address", data: "values", rows: "values", comment: "note", message: "note" },
  create_table: { range: "address", headers: "hasHeaders", has_headers: "hasHeaders" },
  create_chart: {
    range: "dataRange",
    address: "dataRange",
    data: "dataRange",
    source: "dataRange",
    data_range: "dataRange",
    type: "chartType",
    chart_type: "chartType",
    kind: "chartType",
    series_by: "seriesBy",
    position: "placement",
    anchor: "placement",
    yAxisTitle: "valueAxisTitle",
    xAxisTitle: "categoryAxisTitle",
  },
  load_procedure: { procedure: "name", procedureName: "name", title: "name", id: "name" },
};

/** Apply the alias table, without ever overwriting a correctly-named argument. */
export function normalizeArgs(tool: string, args: Record<string, unknown>): Record<string, unknown> {
  const table = ALIASES[tool];
  if (!table) return args;
  const out: Record<string, unknown> = { ...args };
  for (const [from, to] of Object.entries(table)) {
    if (from in out && !(to in out)) {
      out[to] = out[from];
      delete out[from];
    }
  }
  return out;
}

/** Normalise a call's name and arguments together. Returns null for unknown tools. */
export function normalizeCall(call: ToolCall): ToolCall | null {
  const name = normalizeToolName(call.name);
  if (!name) return null;
  return { ...call, name, args: normalizeArgs(name, call.args) };
}

/** Candidate JSON blobs inside a text reply, outermost-first. */
function jsonCandidates(text: string): string[] {
  const out: string[] = [];

  // <tool_call>{...}</tool_call>, the shape Qwen and GLM often emit.
  for (const m of text.matchAll(/<tool_call>([\s\S]*?)<\/tool_call>/gi)) {
    if (m[1]) out.push(m[1].trim());
  }
  // Fenced blocks: ```json, ```tool_call, ```tool_code, or bare ```.
  for (const m of text.matchAll(/```(?:json|tool_call|tool_code|python)?\s*([\s\S]*?)```/gi)) {
    if (m[1]) out.push(m[1].trim());
  }
  // A bare blob spanning the reply, for models that emit JSON and nothing else.
  // Arrays are tried first: a list of calls also contains a "{...}" span, and
  // matching only the braces would recover just one of them.
  const openArr = text.indexOf("[");
  const closeArr = text.lastIndexOf("]");
  if (openArr !== -1 && closeArr > openArr) out.push(text.slice(openArr, closeArr + 1));
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last > first) out.push(text.slice(first, last + 1));

  return out;
}

/** Pull the arguments object out of whichever key this model used. */
function argsOf(obj: Record<string, unknown>): Record<string, unknown> | null {
  for (const key of ["arguments", "parameters", "args", "input"]) {
    const v = obj[key];
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
    if (typeof v === "string") {
      // Some models double-encode the arguments object as a JSON string.
      try {
        const parsed = JSON.parse(v);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        /* not JSON; keep looking */
      }
    }
  }
  return null;
}

/** One call shape, or null when this object is not a tool call at all. */
function asCall(value: unknown, index: number): ToolCall | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  // {"function": {"name": ..., "arguments": ...}} nests one level deeper.
  const fn = obj.function;
  if (fn && typeof fn === "object") {
    const nested = asCall(fn, index);
    if (nested) return { ...nested, id: typeof obj.id === "string" ? obj.id : nested.id };
  }
  const rawName = typeof obj.name === "string" ? obj.name : typeof obj.tool === "string" ? obj.tool : null;
  if (!rawName) return null;
  const name = normalizeToolName(rawName);
  if (!name) return null;
  return { id: `salvaged_${index}`, name, args: normalizeArgs(name, argsOf(obj) ?? {}) };
}

/**
 * Recover tool calls a model described in prose instead of emitting properly.
 *
 * Only used when the turn produced no real tool calls — a model that emitted
 * them correctly is never second-guessed.
 */
export function salvageToolCalls(content: string): ToolCall[] {
  if (!content.trim()) return [];
  for (const candidate of jsonCandidates(content)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    // Either a single call, or a list of them.
    const list = Array.isArray(parsed) ? parsed : [parsed];
    const calls = list.map((v, i) => asCall(v, i)).filter((c): c is ToolCall => c !== null);
    if (calls.length > 0) return calls;
  }
  return [];
}

/**
 * Strip a salvaged call out of the visible reply.
 *
 * Without this the user reads the raw JSON the model leaked, which is the most
 * obvious way a cheap model looks broken even when the work succeeded.
 */
export function stripToolCallText(content: string): string {
  let out = content
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "")
    .replace(/```(?:json|tool_call|tool_code|python)?\s*[\s\S]*?```/gi, "");
  // A reply that was nothing but the call has nothing left worth showing.
  if (out.trim().startsWith("{") && out.trim().endsWith("}")) out = "";
  return out.trim();
}
