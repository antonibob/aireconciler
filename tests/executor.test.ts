import { describe, it, expect, beforeEach } from "vitest";
import {
  columnLetter,
  createExecutor,
  describeColumns,
  startColumnOf,
  startRowOf,
  type ChartSpec,
  type Host,
  type PendingWrite,
  type ReadResult,
} from "../src/office/executor.js";
import type { ToolCall } from "../src/model/tools.js";

function fakeHost(values: Array<Array<string | number | null>>, address = "A1:C9"): Host {
  return {
    async getSheetContext() {
      return {
        sheetName: "Aug",
        usedRangeAddress: address,
        rowCount: values.length,
        columnCount: Math.max(0, ...values.map((r) => r.length)),
        selectionAddress: address,
        sample: values.slice(0, 8),
        tables: [],
      };
    },
    async readRange(addr: string, maxRows: number): Promise<ReadResult> {
      return {
        address: addr,
        values: values.slice(0, maxRows),
        truncated: values.length > maxRows,
        totalRows: values.length,
      };
    },
    async createTable(addr: string) {
      return { address: addr };
    },
    async listSheets() {
      return [{ name: "Aug", position: 0 }];
    },
    async createChart(spec) {
      charted.push(spec);
      return { name: "Chart 1", anchor: spec.placement ?? "E1" };
    },
  };
}

/** Chart specs the fake host received, for asserting on the mapping. */
let charted: ChartSpec[] = [];
beforeEach(() => {
  charted = [];
});

const PROCS = [
  { name: "bank-rec", title: "Bank rec", description: "d", body: "# Bank rec\nSteps.", builtin: true },
];

/** Executor deps with stub procedure lookups; override per test as needed. */
function deps(host: Host, stageWrite: (w: PendingWrite) => void = () => {}) {
  return {
    host,
    stageWrite,
    getProcedure: (n: string) => PROCS.find((p) => p.name === n) ?? null,
    listProcedures: () => PROCS.map(({ name, title, description }) => ({ name, title, description })),
  };
}

const call = (name: string, args: Record<string, unknown> = {}): ToolCall => ({ id: "c1", name, args });

describe("address helpers", () => {
  it("converts column indices to letters past Z", () => {
    expect(columnLetter(0)).toBe("A");
    expect(columnLetter(25)).toBe("Z");
    expect(columnLetter(26)).toBe("AA");
    expect(columnLetter(27)).toBe("AB");
    expect(columnLetter(51)).toBe("AZ");
    expect(columnLetter(52)).toBe("BA");
  });

  it("reads the origin out of an A1 address, with or without a sheet", () => {
    expect(startColumnOf("A1:D9")).toBe(0);
    expect(startColumnOf("C5:D9")).toBe(2);
    expect(startColumnOf("Sheet2!AA3")).toBe(26);
    expect(startRowOf("A1:D9")).toBe(0);
    expect(startRowOf("C5:D9")).toBe(4);
    expect(startRowOf("Sheet2!$B$12")).toBe(11);
  });
});

describe("describeColumns", () => {
  it("labels columns with real letters and infers types", () => {
    const cols = describeColumns(
      [
        ["Date", "Vendor", "Amount"],
        ["2026-08-01", "Acme", "1,250.00"],
        ["2026-08-02", "Beta", "(75.00)"],
      ],
      "C5:E40",
    );
    expect(cols.map((c) => c.letter)).toEqual(["C", "D", "E"]);
    expect(cols[0]?.inferredType).toBe("date");
    expect(cols[1]?.inferredType).toBe("text");
    expect(cols[2]?.inferredType).toBe("amount");
    expect(cols[2]?.header).toBe("Amount");
  });

  it("names unheaded columns by letter rather than leaving them blank", () => {
    const cols = describeColumns([["", "x"], ["1", "2"]], "A1:B2");
    expect(cols[0]?.header).toBe("(column A)");
  });
});

describe("executor dispatch", () => {

  it("loads a procedure's full instructions", async () => {
    const exec = createExecutor(deps(fakeHost([])));
    const res = await exec(call("load_procedure", { name: "bank-rec" }));
    expect(res.isError).toBeUndefined();
    expect((res.content as { instructions: string }).instructions).toContain("Steps.");
  });

  it("names the available procedures when asked for one that does not exist", async () => {
    const exec = createExecutor(deps(fakeHost([])));
    const res = await exec(call("load_procedure", { name: "nope" }));
    expect(res.isError).toBe(true);
    expect(String((res.content as { error: string }).error)).toContain("bank-rec");
  });

  it("lists worksheets so a job can span tabs", async () => {
    const exec = createExecutor(deps(fakeHost([])));
    const res = await exec(call("list_sheets"));
    expect((res.content as { sheets: Array<{ name: string }> }).sheets[0]?.name).toBe("Aug");
  });

  it("maps a friendly chart type to the Excel enum", async () => {
    const exec = createExecutor(deps(fakeHost([["Month", "Fees"], ["Aug", 120], ["Sep", 140]])));
    const res = await exec(
      call("create_chart", { dataRange: "A1:B3", chartType: "columnClustered", title: "Fees by month" }),
    );
    expect(res.isError).toBeUndefined();
    expect(charted[0]?.chartType).toBe("ColumnClustered");
    expect(charted[0]?.title).toBe("Fees by month");
    expect(charted[0]?.seriesBy).toBe("Auto");
  });

  it("names the valid types when given one it does not know", async () => {
    const exec = createExecutor(deps(fakeHost([["a", 1], ["b", 2]])));
    const res = await exec(call("create_chart", { dataRange: "A1:B2", chartType: "3dPyramid", title: "t" }));
    expect(res.isError).toBe(true);
    expect(String((res.content as { error: string }).error)).toContain("columnClustered");
  });

  it("refuses to chart a single cell", async () => {
    const exec = createExecutor(deps(fakeHost([[42]])));
    const res = await exec(call("create_chart", { dataRange: "A1", chartType: "pie", title: "t" }));
    expect(res.isError).toBe(true);
    expect(String((res.content as { error: string }).error)).toMatch(/single cell/i);
    expect(charted).toHaveLength(0);
  });

  it("requires a title, so charts are never unlabelled", async () => {
    const exec = createExecutor(deps(fakeHost([["a", 1], ["b", 2]])));
    const res = await exec(call("create_chart", { dataRange: "A1:B2", chartType: "line" }));
    expect(res.isError).toBe(true);
  });

  it("normalises seriesBy", async () => {
    const exec = createExecutor(deps(fakeHost([["a", 1], ["b", 2]])));
    await exec(call("create_chart", { dataRange: "A1:B2", chartType: "line", title: "t", seriesBy: "ROWS" }));
    expect(charted[0]?.seriesBy).toBe("Rows");
  });

  it("rejects an unknown tool", async () => {
    const exec = createExecutor(deps(fakeHost([])));
    const res = await exec(call("nope"));
    expect(res.isError).toBe(true);
  });

  it("requires an address rather than guessing one", async () => {
    const exec = createExecutor(deps(fakeHost([])));
    expect((await exec(call("read_range"))).isError).toBe(true);
    expect((await exec(call("reconcile_columns", { columnA: 0, columnB: 1 }))).isError).toBe(true);
  });

  it("accepts integer-like strings for column arguments", async () => {
    const exec = createExecutor(deps(fakeHost([["GL", "Bank"], [100, 100]])));
    const res = await exec(call("reconcile_columns", { address: "A1:B2", columnA: "0", columnB: "1" }));
    expect(res.isError).toBeUndefined();
  });

  it("refuses to reconcile a column against itself", async () => {
    const exec = createExecutor(deps(fakeHost([["a", "b"]])));
    const res = await exec(call("reconcile_columns", { address: "A1:B1", columnA: 1, columnB: 1 }));
    expect(res.isError).toBe(true);
  });

  it("rejects out-of-bounds column indices instead of reconciling blanks", async () => {
    const exec = createExecutor(deps(fakeHost([["GL", "Bank"], [1, 1]])));
    const res = await exec(call("reconcile_columns", { address: "A1:B2", columnA: 0, columnB: 7 }));
    expect(res.isError).toBe(true);
    expect(String((res.content as { error: string }).error)).toMatch(/out of bounds/);
  });

  it("maps reconciliation results to real worksheet row numbers", async () => {
    // Range starts at row 5, so the header is sheet row 5 and data starts at 6.
    const host = fakeHost(
      [
        ["GL", "Bank"],
        [100, 100],
        [250, 999],
      ],
      "A5:B7",
    );
    const exec = createExecutor(deps(host));
    const res = await exec(call("reconcile_columns", { address: "A5:B7", columnA: 0, columnB: 1 }));
    const c = res.content as {
      unmatchedGlRows: number[];
      unmatchedBankRows: number[];
      sampleMatches: Array<{ glRow: number; bankRow: number }>;
      balanced: boolean;
    };
    expect(c.sampleMatches[0]).toMatchObject({ glRow: 6, bankRow: 6 });
    expect(c.unmatchedGlRows).toEqual([7]);
    expect(c.unmatchedBankRows).toEqual([7]);
    expect(c.balanced).toBe(false);
  });

  it("stages a write without touching the sheet", async () => {
    const staged: PendingWrite[] = [];
    const exec = createExecutor(deps(fakeHost([["old"]]), (w) => { staged.push(w); }));
    const res = await exec(call("propose_write", { address: "A1", values: [["new"]], note: "set it" }));
    expect(staged).toHaveLength(1);
    expect(staged[0]?.values).toEqual([["new"]]);
    expect(staged[0]?.before).toEqual([["old"]]);
    expect((res.content as { staged: boolean }).staged).toBe(true);
  });

  it("rejects a ragged write rather than writing a misaligned rectangle", async () => {
    const exec = createExecutor(deps(fakeHost([[]])));
    const res = await exec(call("propose_write", { address: "A1", values: [["a", "b"], ["c"]], note: "x" }));
    expect(res.isError).toBe(true);
  });

  it("rejects values that are not an array of rows", async () => {
    const exec = createExecutor(deps(fakeHost([[]])));
    expect((await exec(call("propose_write", { address: "A1", values: "nope", note: "x" }))).isError).toBe(true);
    expect((await exec(call("propose_write", { address: "A1", values: ["a"], note: "x" }))).isError).toBe(true);
  });

  it("caps read_range rather than marshalling an unbounded selection", async () => {
    const big = Array.from({ length: 9000 }, (_, i) => [i]);
    const exec = createExecutor(deps(fakeHost(big)));
    const res = await exec(call("read_range", { address: "A:A", maxRows: 999999 }));
    const c = res.content as { values: unknown[]; truncated: boolean };
    expect(c.values.length).toBe(5000);
    expect(c.truncated).toBe(true);
  });

  it("refuses to reconcile a range past the row ceiling instead of silently truncating", async () => {
    const big = Array.from({ length: 9000 }, () => [1, 1]);
    const exec = createExecutor(deps(fakeHost(big)));
    const res = await exec(call("reconcile_columns", { address: "A1:B9000", columnA: 0, columnB: 1 }));
    expect(res.isError).toBe(true);
    expect(String((res.content as { error: string }).error)).toMatch(/Narrow the address/);
  });
});
