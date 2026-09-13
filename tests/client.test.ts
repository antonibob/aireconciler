import { describe, it, expect } from "vitest";
import {
  applyDelta,
  explainHttpError,
  finalizeCalls,
  parseToolCalls,
  selectToolCapable,
} from "../src/model/client.js";
import { parseGlResponse } from "../src/model/openrouter.js";

describe("parseToolCalls", () => {
  it("parses well-formed calls", () => {
    const calls = parseToolCalls([
      { id: "a", function: { name: "read_range", arguments: '{"address":"A1:B2"}' } },
    ]);
    expect(calls[0]).toEqual({ id: "a", name: "read_range", args: { address: "A1:B2" } });
  });

  it("treats empty arguments as no arguments", () => {
    const calls = parseToolCalls([{ id: "a", function: { name: "get_sheet_context", arguments: "" } }]);
    expect(calls[0]?.args).toEqual({});
    expect(calls[0]?.parseError).toBeUndefined();
  });

  it("flags malformed JSON instead of throwing", () => {
    const calls = parseToolCalls([{ id: "a", function: { name: "x", arguments: "{oops" } }]);
    expect(calls[0]?.parseError).toMatch(/not valid JSON/);
  });

  it("flags non-object arguments, which no tool can consume", () => {
    const calls = parseToolCalls([{ id: "a", function: { name: "x", arguments: "[1,2]" } }]);
    expect(calls[0]?.parseError).toMatch(/not a JSON object/);
  });

  it("returns nothing for a non-array", () => {
    expect(parseToolCalls(undefined)).toEqual([]);
  });
});

describe("streaming accumulation", () => {
  it("concatenates text deltas", () => {
    const calls = new Map();
    let t = "";
    t = applyDelta({ content: "Hel" }, t, calls);
    t = applyDelta({ content: "lo" }, t, calls);
    expect(t).toBe("Hello");
  });

  it("reassembles a tool call split across frames", () => {
    // Name and id arrive once; arguments stream in fragments.
    const calls = new Map();
    let t = "";
    t = applyDelta({ tool_calls: [{ index: 0, id: "c1", function: { name: "read_range" } }] }, t, calls);
    t = applyDelta({ tool_calls: [{ index: 0, function: { arguments: '{"addre' } }] }, t, calls);
    t = applyDelta({ tool_calls: [{ index: 0, function: { arguments: 'ss":"A1"}' } }] }, t, calls);
    const out = finalizeCalls(calls);
    expect(out).toEqual([{ id: "c1", name: "read_range", args: { address: "A1" } }]);
  });

  it("keeps parallel tool calls apart by index", () => {
    const calls = new Map();
    let t = "";
    t = applyDelta(
      {
        tool_calls: [
          { index: 0, id: "a", function: { name: "one", arguments: "{}" } },
          { index: 1, id: "b", function: { name: "two", arguments: "{}" } },
        ],
      },
      t,
      calls,
    );
    const out = finalizeCalls(calls);
    expect(out.map((c) => c.name)).toEqual(["one", "two"]);
  });

  it("ignores a null delta", () => {
    expect(applyDelta(null, "x", new Map())).toBe("x");
  });
});

describe("selectToolCapable", () => {
  const catalogue = [
    { id: "a/tools", supported_parameters: ["tools", "temperature"], pricing: { prompt: "0.000003" }, context_length: 200000 },
    { id: "b/no-tools", supported_parameters: ["temperature"], pricing: { prompt: "0.0000001" } },
    { id: "c/cheap", supported_parameters: ["tools"], pricing: { prompt: "0.0000005" } },
  ];

  it("keeps only models that support tool calling", () => {
    expect(selectToolCapable(catalogue).map((m) => m.id)).toEqual(["c/cheap", "a/tools"]);
  });

  it("sorts cheapest first", () => {
    const out = selectToolCapable(catalogue);
    expect(out[0]?.promptPrice).toBeLessThan(out[1]!.promptPrice);
  });

  it("survives a malformed catalogue", () => {
    expect(selectToolCapable(null)).toEqual([]);
    expect(selectToolCapable([{ supported_parameters: ["tools"] }])).toEqual([]); // no id
  });
});

describe("explainHttpError", () => {
  it("translates the errors a user can actually act on", () => {
    expect(explainHttpError(401, "")).toMatch(/API key/);
    expect(explainHttpError(402, "")).toMatch(/credit/);
    expect(explainHttpError(429, "")).toMatch(/rate-limit/);
    expect(explainHttpError(404, "no such model")).toMatch(/model id/);
    expect(explainHttpError(500, "boom")).toMatch(/HTTP 500/);
  });
});

describe("parseGlResponse", () => {
  const shape = [{ glCode: "7012-10", confidence: "high", reason: "marketing" }];

  it("accepts the documented {codes:[...]} shape", () => {
    expect(parseGlResponse(JSON.stringify({ codes: shape }), 1)?.[0]?.glCode).toBe("7012-10");
  });

  it("accepts a bare array, which models emit regardless of the prompt", () => {
    expect(parseGlResponse(JSON.stringify(shape), 1)?.[0]?.glCode).toBe("7012-10");
  });

  it("strips code fences", () => {
    expect(parseGlResponse("```json\n" + JSON.stringify(shape) + "\n```", 1)?.[0]?.glCode).toBe("7012-10");
  });

  it("salvages JSON embedded in prose", () => {
    expect(parseGlResponse("Here you go: " + JSON.stringify(shape), 1)?.[0]?.glCode).toBe("7012-10");
  });

  it("defaults an unrecognised confidence to low rather than trusting it", () => {
    const out = parseGlResponse(JSON.stringify([{ glCode: "1", confidence: "certain", reason: "r" }]), 1);
    expect(out?.[0]?.confidence).toBe("low");
  });

  it("returns null when there is no JSON at all", () => {
    expect(parseGlResponse("I could not do that.", 1)).toBeNull();
  });
});
