import { describe, it, expect, beforeEach } from "vitest";
import { splitAddress } from "../src/office/executor.js";
import { normalizeName, summarize } from "../src/procedures/types.js";
import { BUILTIN_PROCEDURES } from "../src/procedures/builtin.js";
import {
  allProcedures,
  deleteProcedure,
  getProcedure,
  listProcedures,
  proceduresMenu,
  saveProcedure,
} from "../src/procedures/store.js";

/** The store is browser-backed; vitest runs in node, so stand localStorage up. */
function installLocalStorage() {
  const map = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  };
}

describe("splitAddress", () => {
  it("treats a bare address as the active sheet", () => {
    expect(splitAddress("A1:D9")).toEqual({ sheet: null, cell: "A1:D9" });
  });

  it("separates a named sheet", () => {
    expect(splitAddress("Cashbook!B2:D40")).toEqual({ sheet: "Cashbook", cell: "B2:D40" });
  });

  it("unquotes a sheet name containing spaces", () => {
    expect(splitAddress("'Q3 Bank'!A1:C5")).toEqual({ sheet: "Q3 Bank", cell: "A1:C5" });
  });

  it("handles an escaped apostrophe in a sheet name", () => {
    expect(splitAddress("'Bob''s tab'!A1")).toEqual({ sheet: "Bob's tab", cell: "A1" });
  });
});

describe("normalizeName", () => {
  it("slugifies a title", () => {
    expect(normalizeName("Bank Reconciliation")).toBe("bank-reconciliation");
    expect(normalizeName("  Month-End  Close!  ")).toBe("month-end-close");
  });

  it("never produces leading or trailing separators", () => {
    expect(normalizeName("!!!weird!!!")).toBe("weird");
  });
});

describe("procedure store", () => {
  beforeEach(() => {
    installLocalStorage();
    localStorage.clear();
  });

  it("starts with the built-ins", () => {
    const names = listProcedures().map((p) => p.name);
    expect(names).toEqual(BUILTIN_PROCEDURES.map((p) => p.name));
  });

  it("round-trips a user procedure", () => {
    saveProcedure({ title: "Month End Close", description: "when closing a month", body: "# Steps" });
    const got = getProcedure("month-end-close");
    expect(got?.title).toBe("Month End Close");
    expect(got?.body).toBe("# Steps");
    expect(got?.builtin).toBe(false);
  });

  it("looks a procedure up by an unslugified name", () => {
    saveProcedure({ title: "Month End Close", description: "d", body: "b" });
    expect(getProcedure("Month End Close")?.name).toBe("month-end-close");
  });

  it("lets a user procedure override a built-in of the same name", () => {
    const target = BUILTIN_PROCEDURES[0]!.name;
    saveProcedure({ name: target, title: "Ours", description: "our way", body: "# Our method" });
    const all = allProcedures().filter((p) => p.name === target);
    expect(all).toHaveLength(1);
    expect(all[0]?.body).toBe("# Our method");
    expect(all[0]?.builtin).toBe(false);
  });

  it("restores the built-in when the override is deleted", () => {
    const target = BUILTIN_PROCEDURES[0]!.name;
    saveProcedure({ name: target, title: "Ours", description: "d", body: "x" });
    deleteProcedure(target);
    expect(getProcedure(target)?.builtin).toBe(true);
  });

  it("replaces rather than duplicates on re-save", () => {
    saveProcedure({ title: "Thing", description: "a", body: "1" });
    saveProcedure({ title: "Thing", description: "b", body: "2" });
    expect(allProcedures().filter((p) => p.name === "thing")).toHaveLength(1);
    expect(getProcedure("thing")?.body).toBe("2");
  });

  it("survives corrupt storage rather than failing the pane", () => {
    localStorage.setItem("ai-closer-procedures", "{not json");
    expect(listProcedures().length).toBe(BUILTIN_PROCEDURES.length);
  });

  it("ignores stored entries with the wrong shape", () => {
    localStorage.setItem("ai-closer-procedures", JSON.stringify([{ name: "x" }]));
    expect(listProcedures().length).toBe(BUILTIN_PROCEDURES.length);
  });

  it("returns null for an unknown procedure", () => {
    expect(getProcedure("does-not-exist")).toBeNull();
  });
});

describe("proceduresMenu", () => {
  it("is one line per procedure, so context stays small", () => {
    const menu = proceduresMenu([
      { name: "a", title: "A", description: "do a" },
      { name: "b", title: "B", description: "do b" },
    ]);
    expect(menu).toContain("- a: do a");
    expect(menu).toContain("- b: do b");
    expect(menu).toMatch(/load_procedure/);
  });

  it("is empty when nothing is defined, rather than an empty heading", () => {
    expect(proceduresMenu([])).toBe("");
  });
});

describe("built-in procedures", () => {
  it("carry the domain knowledge that makes them worth following", () => {
    const rec = BUILTIN_PROCEDURES.find((p) => p.name === "bank-reconciliation");
    expect(rec).toBeDefined();
    // The value is the specifics, not the structure; guard a few of them.
    expect(rec!.body).toMatch(/wire fee/i);
    expect(rec!.body).toMatch(/1\.50/); // e-transfer send fee
    expect(rec!.body).toMatch(/must sum to the target/i);
  });

  it("summarize drops the body so the menu stays cheap", () => {
    const s = summarize(BUILTIN_PROCEDURES[0]!);
    expect(s).not.toHaveProperty("body");
    expect(s.description.length).toBeGreaterThan(0);
  });
});
