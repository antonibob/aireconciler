import { describe, it, expect } from "vitest";
import {
  normalizeArgs,
  normalizeCall,
  normalizeToolName,
  salvageToolCalls,
  stripToolCallText,
} from "../src/model/salvage.js";

describe("normalizeToolName", () => {
  it("accepts the canonical name unchanged", () => {
    expect(normalizeToolName("read_range")).toBe("read_range");
  });

  it("accepts the casing and separator variants models actually emit", () => {
    expect(normalizeToolName("readRange")).toBe("read_range");
    expect(normalizeToolName("read-range")).toBe("read_range");
    expect(normalizeToolName("READ_RANGE")).toBe("read_range");
    expect(normalizeToolName("ReadRange")).toBe("read_range");
  });

  it("strips a namespace prefix", () => {
    expect(normalizeToolName("functions.read_range")).toBe("read_range");
    expect(normalizeToolName("tool:create_chart")).toBe("create_chart");
  });

  it("returns null for something that is not a tool", () => {
    expect(normalizeToolName("delete_everything")).toBeNull();
    expect(normalizeToolName("")).toBeNull();
  });
});

describe("normalizeArgs", () => {
  it("renames the aliases models reach for", () => {
    expect(normalizeArgs("read_range", { range: "A1:B2" })).toEqual({ address: "A1:B2" });
    expect(normalizeArgs("create_chart", { range: "A1:B9", type: "line" })).toEqual({
      dataRange: "A1:B9",
      chartType: "line",
    });
  });

  it("never overwrites a correctly-named argument", () => {
    // If the model sent both, the schema name is the one it meant.
    expect(normalizeArgs("read_range", { address: "A1", range: "Z99" })).toEqual({
      address: "A1",
      range: "Z99",
    });
  });

  it("leaves unknown arguments alone for the tool to reject", () => {
    expect(normalizeArgs("read_range", { wat: 1 })).toEqual({ wat: 1 });
  });

  it("maps snake_case column aliases on reconcile", () => {
    expect(normalizeArgs("reconcile_columns", { range: "A1:C9", col_a: 0, col_b: 2 })).toEqual({
      address: "A1:C9",
      columnA: 0,
      columnB: 2,
    });
  });
});

describe("normalizeCall", () => {
  it("fixes name and arguments together", () => {
    const out = normalizeCall({ id: "c1", name: "readRange", args: { range: "A1:B2" } });
    expect(out).toEqual({ id: "c1", name: "read_range", args: { address: "A1:B2" } });
  });

  it("drops a call to a tool that does not exist", () => {
    expect(normalizeCall({ id: "c1", name: "rm_rf", args: {} })).toBeNull();
  });
});

describe("salvageToolCalls", () => {
  it("recovers a fenced JSON call", () => {
    const text = 'I will read the range.\n```json\n{"name":"read_range","arguments":{"address":"A1:D9"}}\n```';
    expect(salvageToolCalls(text)).toEqual([
      { id: "salvaged_0", name: "read_range", args: { address: "A1:D9" } },
    ]);
  });

  it("recovers a <tool_call> block", () => {
    const text = '<tool_call>{"name": "get_sheet_context", "arguments": {}}</tool_call>';
    expect(salvageToolCalls(text)[0]).toMatchObject({ name: "get_sheet_context", args: {} });
  });

  it("recovers a bare JSON object with no fence", () => {
    const text = '{"name":"list_sheets","parameters":{}}';
    expect(salvageToolCalls(text)[0]?.name).toBe("list_sheets");
  });

  it("handles arguments double-encoded as a JSON string", () => {
    const text = '{"name":"read_range","arguments":"{\\"address\\":\\"B2:C5\\"}"}';
    expect(salvageToolCalls(text)[0]?.args).toEqual({ address: "B2:C5" });
  });

  it("unwraps the OpenAI-style function nesting", () => {
    const text = '{"id":"abc","function":{"name":"list_sheets","arguments":"{}"}}';
    const out = salvageToolCalls(text)[0];
    expect(out?.name).toBe("list_sheets");
    expect(out?.id).toBe("abc");
  });

  it("recovers several calls from one array", () => {
    const text = '[{"name":"list_sheets","arguments":{}},{"name":"get_sheet_context","arguments":{}}]';
    expect(salvageToolCalls(text).map((c) => c.name)).toEqual(["list_sheets", "get_sheet_context"]);
  });

  it("normalises names and aliases while salvaging", () => {
    const text = '```json\n{"name":"createChart","arguments":{"range":"A1:B5","type":"line","title":"t"}}\n```';
    expect(salvageToolCalls(text)[0]).toMatchObject({
      name: "create_chart",
      args: { dataRange: "A1:B5", chartType: "line", title: "t" },
    });
  });

  it("returns nothing for ordinary prose", () => {
    expect(salvageToolCalls("The residual is 42.17 and does not clear.")).toEqual([]);
  });

  it("returns nothing for JSON that is not a tool call", () => {
    expect(salvageToolCalls('{"residual": 42.17, "balanced": false}')).toEqual([]);
  });

  it("ignores a JSON blob naming a tool that does not exist", () => {
    expect(salvageToolCalls('{"name":"drop_tables","arguments":{}}')).toEqual([]);
  });

  it("is not fooled by an empty reply", () => {
    expect(salvageToolCalls("")).toEqual([]);
    expect(salvageToolCalls("   ")).toEqual([]);
  });
});

describe("stripToolCallText", () => {
  it("removes the leaked JSON but keeps the prose", () => {
    const text = 'Reading the range now.\n```json\n{"name":"read_range","arguments":{}}\n```';
    expect(stripToolCallText(text)).toBe("Reading the range now.");
  });

  it("removes a tool_call block", () => {
    expect(stripToolCallText('Ok.<tool_call>{"name":"x"}</tool_call>')).toBe("Ok.");
  });

  it("returns empty when the reply was only the call", () => {
    expect(stripToolCallText('{"name":"read_range","arguments":{}}')).toBe("");
  });

  it("leaves ordinary prose untouched", () => {
    expect(stripToolCallText("The residual is 42.17.")).toBe("The residual is 42.17.");
  });
});
