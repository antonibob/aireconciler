import { describe, it, expect } from "vitest";
import { runAgent, trimHistory, type StreamFn } from "../src/taskpane/agent.js";
import type { ChatMessage, ChatTurn, ClientConfig } from "../src/model/client.js";
import type { ToolCall, ToolResult } from "../src/model/tools.js";

const cfg: ClientConfig = { apiKey: "k", model: "m" };

/** A scripted model: returns each queued turn in order. */
function scripted(turns: ChatTurn[]): { fn: StreamFn; seen: ChatMessage[][] } {
  const seen: ChatMessage[][] = [];
  let i = 0;
  const fn: StreamFn = async (messages, _tools, _cfg, onText) => {
    seen.push(messages.map((m) => ({ ...m })));
    const turn = turns[i++] ?? { content: "", toolCalls: [], ok: true };
    if (turn.content) onText(turn.content);
    return turn;
  };
  return { fn, seen };
}

const echoExecutor = async (call: ToolCall): Promise<ToolResult> => ({
  toolCallId: call.id,
  name: call.name,
  content: { echoed: call.args },
});

describe("runAgent", () => {
  it("returns immediately when the model asks for no tools", async () => {
    const { fn } = scripted([{ content: "Nothing to do.", toolCalls: [], ok: true }]);
    const events: string[] = [];
    const out = await runAgent({
      messages: [{ role: "user", content: "hi" }],
      cfg,
      execute: echoExecutor,
      stream: fn,
      onEvent: (e) => events.push(e.type),
    });
    expect(out.ok).toBe(true);
    expect(events).toContain("turn_end");
    expect(out.messages.at(-1)).toEqual({ role: "assistant", content: "Nothing to do." });
  });

  it("executes a tool call and feeds the result back before answering", async () => {
    const call: ToolCall = { id: "c1", name: "get_sheet_context", args: {} };
    const { fn, seen } = scripted([
      { content: "", toolCalls: [call], ok: true },
      { content: "Sheet has 3 columns.", toolCalls: [], ok: true },
    ]);
    const out = await runAgent({
      messages: [{ role: "user", content: "what's in the sheet" }],
      cfg,
      execute: echoExecutor,
      stream: fn,
      onEvent: () => {},
    });

    expect(out.ok).toBe(true);
    // The second model call must see the assistant tool_calls turn and its result.
    const second = seen[1]!;
    expect(second.some((m) => m.role === "assistant" && m.toolCalls?.length === 1)).toBe(true);
    const toolMsg = second.find((m) => m.role === "tool");
    expect(toolMsg?.toolCallId).toBe("c1");
    expect(JSON.parse(toolMsg!.content)).toEqual({ echoed: {} });
  });

  it("reports a tool that throws instead of aborting the turn", async () => {
    const call: ToolCall = { id: "c1", name: "read_range", args: { address: "A1" } };
    const { fn, seen } = scripted([
      { content: "", toolCalls: [call], ok: true },
      { content: "That range is unavailable.", toolCalls: [], ok: true },
    ]);
    const out = await runAgent({
      messages: [{ role: "user", content: "read A1" }],
      cfg,
      execute: async () => {
        throw new Error("range exploded");
      },
      stream: fn,
      onEvent: () => {},
    });
    expect(out.ok).toBe(true);
    const toolMsg = seen[1]!.find((m) => m.role === "tool");
    expect(JSON.parse(toolMsg!.content)).toEqual({ error: "range exploded" });
  });

  it("hands unparseable tool arguments back to the model rather than executing", async () => {
    const bad: ToolCall = { id: "c1", name: "read_range", args: {}, parseError: "not JSON" };
    const { fn, seen } = scripted([
      { content: "", toolCalls: [bad], ok: true },
      { content: "Retrying.", toolCalls: [], ok: true },
    ]);
    let executed = false;
    await runAgent({
      messages: [{ role: "user", content: "x" }],
      cfg,
      execute: async (c) => {
        executed = true;
        return { toolCallId: c.id, name: c.name, content: {} };
      },
      stream: fn,
      onEvent: () => {},
    });
    expect(executed).toBe(false);
    expect(JSON.parse(seen[1]!.find((m) => m.role === "tool")!.content)).toEqual({ error: "not JSON" });
  });

  it("stops and reports when the model loops past maxSteps", async () => {
    const call: ToolCall = { id: "c", name: "get_sheet_context", args: {} };
    const fn: StreamFn = async () => ({ content: "", toolCalls: [call], ok: true });
    const errors: string[] = [];
    const out = await runAgent({
      messages: [{ role: "user", content: "loop" }],
      cfg,
      execute: echoExecutor,
      stream: fn,
      maxSteps: 3,
      onEvent: (e) => {
        if (e.type === "error") errors.push(e.message);
      },
    });
    expect(out.ok).toBe(false);
    expect(errors[0]).toMatch(/3 tool steps/);
  });

  it("surfaces a failed model call without inventing an answer", async () => {
    const fn: StreamFn = async () => ({ content: "", toolCalls: [], ok: false, error: "HTTP 401" });
    const errors: string[] = [];
    const out = await runAgent({
      messages: [{ role: "user", content: "x" }],
      cfg,
      execute: echoExecutor,
      stream: fn,
      onEvent: (e) => {
        if (e.type === "error") errors.push(e.message);
      },
    });
    expect(out.ok).toBe(false);
    expect(errors).toEqual(["HTTP 401"]);
  });

  it("accumulates reported cost across tool steps", async () => {
    const call: ToolCall = { id: "c1", name: "get_sheet_context", args: {} };
    const { fn } = scripted([
      { content: "", toolCalls: [call], ok: true, cost: 0.002 },
      { content: "done", toolCalls: [], ok: true, cost: 0.003 },
    ]);
    const out = await runAgent({
      messages: [{ role: "user", content: "x" }],
      cfg,
      execute: echoExecutor,
      stream: fn,
      onEvent: () => {},
    });
    expect(out.totalCost).toBeCloseTo(0.005, 6);
  });
});

describe("trimHistory", () => {
  const sys: ChatMessage = { role: "system", content: "S" };

  it("keeps everything when under the cap", () => {
    const msgs = [sys, { role: "user" as const, content: "a" }];
    expect(trimHistory(msgs, 10)).toEqual(msgs);
  });

  it("always keeps the system prompt", () => {
    const msgs: ChatMessage[] = [sys, ...Array.from({ length: 20 }, (_, i) => ({ role: "user" as const, content: `m${i}` }))];
    const out = trimHistory(msgs, 5);
    expect(out[0]).toEqual(sys);
    expect(out).toHaveLength(6);
  });

  it("never starts the window on an orphaned tool reply", () => {
    // An assistant turn with tool_calls must keep its tool replies together;
    // a leading tool message with no matching call is rejected by the API.
    const msgs: ChatMessage[] = [
      sys,
      { role: "user", content: "q" },
      { role: "assistant", content: "", toolCalls: [{ id: "t1", name: "x", args: {} }] },
      { role: "tool", toolCallId: "t1", content: "{}" },
      { role: "assistant", content: "a" },
    ];
    const out = trimHistory(msgs, 2);
    expect(out.find((m) => m.role === "tool")).toBeUndefined();
    expect(out[1]?.role).not.toBe("tool");
  });
});

describe("runAgent with a model that does not emit tool calls properly", () => {
  it("recovers a call the model wrote as fenced JSON in its reply", async () => {
    // The characteristic DeepSeek/GLM failure: it knows what to call, and says
    // so in prose instead of using the tool_calls field.
    const { fn, seen } = scripted([
      {
        content: 'Let me look at the sheet.\n```json\n{"name":"get_sheet_context","arguments":{}}\n```',
        toolCalls: [],
        ok: true,
      },
      { content: "Three columns: Date, Vendor, Amount.", toolCalls: [], ok: true },
    ]);
    const calls: string[] = [];
    const out = await runAgent({
      messages: [{ role: "user", content: "what's in the sheet" }],
      cfg,
      execute: async (c) => {
        calls.push(c.name);
        return { toolCallId: c.id, name: c.name, content: { ok: true } };
      },
      stream: fn,
      onEvent: () => {},
    });

    expect(out.ok).toBe(true);
    expect(calls).toEqual(["get_sheet_context"]);
    // The leaked JSON must not survive into the transcript the user reads.
    const assistant = seen[1]!.find((m) => m.role === "assistant");
    expect(assistant?.content).toBe("Let me look at the sheet.");
    expect(assistant?.content).not.toContain("{");
  });

  it("repairs a misnamed tool and aliased arguments", async () => {
    const { fn } = scripted([
      { content: "", toolCalls: [{ id: "c1", name: "readRange", args: { range: "A1:B9" } }], ok: true },
      { content: "done", toolCalls: [], ok: true },
    ]);
    const received: Array<{ name: string; args: unknown }> = [];
    await runAgent({
      messages: [{ role: "user", content: "read it" }],
      cfg,
      execute: async (c) => {
        received.push({ name: c.name, args: c.args });
        return { toolCallId: c.id, name: c.name, content: {} };
      },
      stream: fn,
      onEvent: () => {},
    });
    expect(received[0]).toEqual({ name: "read_range", args: { address: "A1:B9" } });
  });

  it("treats a reply that only looks like JSON as an ordinary answer", async () => {
    const { fn } = scripted([
      { content: '{"residual": 42.17, "balanced": false}', toolCalls: [], ok: true },
    ]);
    let executed = false;
    const out = await runAgent({
      messages: [{ role: "user", content: "x" }],
      cfg,
      execute: async (c) => {
        executed = true;
        return { toolCallId: c.id, name: c.name, content: {} };
      },
      stream: fn,
      onEvent: () => {},
    });
    expect(executed).toBe(false);
    expect(out.ok).toBe(true);
  });
});
