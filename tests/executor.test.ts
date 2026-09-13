import { describe, it, expect } from "vitest";
import {
  columnLetter,
  createExecutor,
  describeColumns,
  startColumnOf,
  startRowOf,
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
  const stageNoop = () => {};

  it("rejects an unknown tool", async () => {
    const exec = createExecutor({ host: fakeHost([]), stageWrite: stageNoop });
    const res = await exec(call("nope"));
    expect(res.isError).toBe(true);
  });

  it("requires an address rather than guessing one", async () => {
    const exec = createExecutor({ host: fakeHost([]), stageWrite: stageNoop });
    expect((await exec(call("read_range"))).isError).toBe(true);
    expect((await exec(call("reconcile_columns", { columnA: 0, columnB: 1 }))).isError).toBe(true);
  });

  it("accepts integer-like strings for column arguments", async () => {
    const exec = createExecutor({
      host: fakeHost([["GL", "Bank"], [100, 100]]),
      stageWrite: stageNoop,
    });
    const res = await exec(call("reconcile_columns", { address: "A1:B2", columnA: "0", columnB: "1" }));
    expect(res.isError).toBeUndefined();
  });

  it("refuses to reconcile a column against itself", async () => {
    const exec = createExecutor({ host: fakeHost([["a", "b"]]), stageWrite: stageNoop });
    const res = await exec(call("reconcile_columns", { address: "A1:B1", columnA: 1, columnB: 1 }));
    expect(res.isError).toBe(true);
  });

  it("rejects out-of-bounds column indices instead of reconciling blanks", async () => {
    const exec = createExecutor({ host: fakeHost([["GL", "Bank"], [1, 1]]), stageWrite: stageNoop });
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
    const exec = createExecutor({ host, stageWrite: stageNoop });
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
    const exec = createExecutor({
      host: fakeHost([["old"]]),
      stageWrite: (w) => staged.push(w),
    });
    const res = await exec(call("propose_write", { address: "A1", values: [["new"]], note: "set it" }));
    expect(staged).toHaveLength(1);
    expect(staged[0]?.values).toEqual([["new"]]);
    expect(staged[0]?.before).toEqual([["old"]]);
    expect((res.content as { staged: boolean }).staged).toBe(true);
  });

  it("rejects a ragged write rather than writing a misaligned rectangle", async () => {
    const exec = createExecutor({ host: fakeHost([[]]), stageWrite: stageNoop });
    const res = await exec(call("propose_write", { address: "A1", values: [["a", "b"], ["c"]], note: "x" }));
    expect(res.isError).toBe(true);
  });

  it("rejects values that are not an array of rows", async () => {
    const exec = createExecutor({ host: fakeHost([[]]), stageWrite: stageNoop });
    expect((await exec(call("propose_write", { address: "A1", values: "nope", note: "x" }))).isError).toBe(true);
    expect((await exec(call("propose_write", { address: "A1", values: ["a"], note: "x" }))).isError).toBe(true);
  });

  it("caps read_range rather than marshalling an unbounded selection", async () => {
    const big = Array.from({ length: 9000 }, (_, i) => [i]);
    const exec = createExecutor({ host: fakeHost(big), stageWrite: stageNoop });
    const res = await exec(call("read_range", { address: "A:A", maxRows: 999999 }));
    const c = res.content as { values: unknown[]; truncated: boolean };
    expect(c.values.length).toBe(5000);
    expect(c.truncated).toBe(true);
  });

  it("refuses to reconcile a range past the row ceiling instead of silently truncating", async () => {
    const big = Array.from({ length: 9000 }, () => [1, 1]);
    const exec = createExecutor({ host: fakeHost(big), stageWrite: stageNoop });
    const res = await exec(call("reconcile_columns", { address: "A1:B9000", columnA: 0, columnB: 1 }));
    expect(res.isError).toBe(true);
    expect(String((res.content as { error: string }).error)).toMatch(/Narrow the address/);
  });
});
