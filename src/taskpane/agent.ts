/**
 * The agent loop.
 *
 * This is what used to be four competing regexes (wantsApply / wantsWrite /
 * wantsTable / wantsReconcile) plus a scrape of the model's prose afterwards.
 * Now the model is shown its tools and picks; we execute, feed results back,
 * and repeat until it has nothing left to call. The app no longer guesses what
 * the user meant, and never acts on a branch the model did not choose.
 */

import {
  streamWithTools,
  type ChatMessage,
  type ChatTurn,
  type ClientConfig,
} from "../model/client.js";
import { normalizeCall, salvageToolCalls, stripToolCallText } from "../model/salvage.js";
import { TOOLS, type ToolCall, type ToolResult } from "../model/tools.js";

export type AgentEvent =
  | { type: "text"; delta: string }
  | { type: "tool_start"; call: ToolCall }
  | { type: "tool_end"; call: ToolCall; result: ToolResult }
  | { type: "turn_end"; content: string; cost?: number }
  | { type: "error"; message: string };

/** Executes one tool call against the host. Injected so the loop stays testable. */
export type ToolExecutor = (call: ToolCall) => Promise<ToolResult>;

/** The model call. Injected so the loop can be tested without a live model. */
export type StreamFn = (
  messages: ChatMessage[],
  tools: typeof TOOLS,
  cfg: ClientConfig,
  onText: (chunk: string) => void,
) => Promise<ChatTurn>;

export interface AgentOptions {
  messages: ChatMessage[];
  cfg: ClientConfig;
  execute: ToolExecutor;
  onEvent: (e: AgentEvent) => void;
  /** Hard stop on runaway tool loops. */
  maxSteps?: number;
  stream?: StreamFn;
}

export interface AgentOutcome {
  /** The full message list including assistant and tool turns, for the next send. */
  messages: ChatMessage[];
  ok: boolean;
  totalCost: number;
}

const DEFAULT_MAX_STEPS = 8;

export async function runAgent(opts: AgentOptions): Promise<AgentOutcome> {
  const { cfg, execute, onEvent } = opts;
  const stream = opts.stream ?? streamWithTools;
  const maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS;
  const messages = [...opts.messages];
  let totalCost = 0;

  for (let step = 0; step < maxSteps; step++) {
    const turn: ChatTurn = await stream(messages, TOOLS, cfg, (delta) =>
      onEvent({ type: "text", delta }),
    );

    if (!turn.ok) {
      onEvent({ type: "error", message: turn.error ?? "Unknown error." });
      return { messages, ok: false, totalCost };
    }
    if (turn.cost !== undefined) totalCost += turn.cost;

    // Cheaper models routinely know what to call and then describe it as text
    // instead of emitting it. Recover those rather than showing the user raw
    // JSON and stopping — the model choice should not decide whether the pane
    // works. A model that emitted calls properly is never second-guessed.
    let content = turn.content;
    let toolCalls = turn.toolCalls.map(normalizeCall).filter((c): c is ToolCall => c !== null);
    if (toolCalls.length === 0) {
      const salvaged = salvageToolCalls(turn.content);
      if (salvaged.length > 0) {
        toolCalls = salvaged;
        content = stripToolCallText(turn.content);
      }
    }

    // No tools requested: the model is answering, so the turn is over.
    if (toolCalls.length === 0) {
      messages.push({ role: "assistant", content });
      onEvent({ type: "turn_end", content, cost: turn.cost });
      return { messages, ok: true, totalCost };
    }

    messages.push({ role: "assistant", content, toolCalls });

    for (const call of toolCalls) {
      onEvent({ type: "tool_start", call });
      const result = await runOne(call, execute);
      onEvent({ type: "tool_end", call, result });
      messages.push({
        role: "tool",
        toolCallId: call.id,
        content: JSON.stringify(result.content),
      });
    }
  }

  // Out of steps with tools still pending. Say so rather than silently
  // truncating — a half-finished reconciliation must not look complete.
  const message = `Stopped after ${maxSteps} tool steps without a final answer. Narrow the request and try again.`;
  onEvent({ type: "error", message });
  return { messages, ok: false, totalCost };
}

/** Run one call, converting a thrown error or bad arguments into a tool result. */
async function runOne(call: ToolCall, execute: ToolExecutor): Promise<ToolResult> {
  if (call.parseError) {
    // Hand the problem back to the model; it can usually reissue the call.
    return {
      toolCallId: call.id,
      name: call.name,
      content: { error: call.parseError },
      isError: true,
    };
  }
  try {
    return await execute(call);
  } catch (err) {
    return {
      toolCallId: call.id,
      name: call.name,
      content: { error: err instanceof Error ? err.message : String(err) },
      isError: true,
    };
  }
}

/**
 * Keep the replayed history bounded. The old pane resent every message on every
 * turn, so latency and spend grew until the context overflowed. The system
 * prompt is always kept; recent turns matter more than old ones.
 *
 * Tool results are dropped before their originating assistant turn is, because
 * an assistant turn carrying tool_calls with no matching tool replies is a
 * malformed request that OpenRouter rejects.
 */
export function trimHistory(messages: ChatMessage[], maxTurns = 12): ChatMessage[] {
  const system = messages.filter((m) => m.role === "system");
  const rest = messages.filter((m) => m.role !== "system");
  if (rest.length <= maxTurns) return messages;

  let cut = rest.length - maxTurns;
  // Never start the window on an orphaned tool reply.
  while (cut < rest.length && rest[cut]?.role === "tool") cut++;
  return [...system, ...rest.slice(cut)];
}
