/**
 * Live-host self check.
 *
 * Everything in src/office/excelHost.ts is unexercised by the test suite: CI has
 * no Excel, so the structural types compile against nothing. The paths that
 * matter most are also the ones hardest to reach by hand — a cross-sheet read,
 * a mixed literal/formula write, the undo that restores prior formulas.
 *
 * This walks each of them in a scratch worksheet and reports what actually
 * happened, so a sideload either proves the Office.js layer works or names the
 * exact step that does not. The scratch sheet is removed at the end, including
 * when a check throws — the workbook is left as it was found.
 */

import {
  applyWrite,
  createScratchSheet,
  deleteScratchSheet,
  excelHost,
  isInExcel,
  revertWrite,
} from "./excelHost.js";
import type { CellValue } from "./executor.js";

export type CheckStatus = "pass" | "fail" | "skip";

export interface Check {
  name: string;
  status: CheckStatus;
  /** What happened — the observed value on a pass, the reason on a failure. */
  detail: string;
}

const SCRATCH = "AI Closer check";

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  // Office.js rejects with a plain object carrying code/message.
  const e = err as { code?: string; message?: string };
  return e?.message ? `${e.code ?? "error"}: ${e.message}` : String(err);
}

/** Run one check, turning a throw into a failed result rather than aborting. */
async function step(name: string, fn: () => Promise<string>): Promise<Check> {
  try {
    return { name, status: "pass", detail: await fn() };
  } catch (err) {
    return { name, status: "fail", detail: describe(err) };
  }
}

function cell(values: CellValue[][], r: number, c: number): CellValue {
  return values[r]?.[c] ?? null;
}

export async function runDiagnostics(onProgress?: (c: Check) => void): Promise<Check[]> {
  const results: Check[] = [];
  const record = (c: Check) => {
    results.push(c);
    onProgress?.(c);
    return c;
  };

  if (!isInExcel()) {
    record({
      name: "Excel host",
      status: "skip",
      detail: "Not running inside Excel. Sideload the add-in and run this from the task pane.",
    });
    return results;
  }
  record({ name: "Excel host", status: "pass", detail: "Office.js is available." });

  let scratchReady = false;

  try {
    // --- Reads against the real workbook, before touching anything ----------
    const sheets = record(
      await step("List worksheets", async () => {
        const list = await excelHost.listSheets();
        if (list.length === 0) throw new Error("No worksheets returned.");
        return `${list.length} sheet(s): ${list.map((s) => s.name).join(", ")}`;
      }),
    );

    record(
      await step("Read active sheet context", async () => {
        const ctx = await excelHost.getSheetContext(8);
        return ctx.usedRangeAddress
          ? `"${ctx.sheetName}" used range ${ctx.usedRangeAddress} (${ctx.rowCount} rows x ${ctx.columnCount} cols), ${ctx.sample.length} sample row(s).`
          : `"${ctx.sheetName}" is empty — that is a valid result, but open a sheet with data for a fuller check.`;
      }),
    );

    if (sheets.status !== "pass") {
      record({
        name: "Remaining checks",
        status: "skip",
        detail: "Skipped because the worksheet collection could not be read.",
      });
      return results;
    }

    // --- Scratch sheet, so nothing below can damage real data --------------
    const created = record(
      await step(`Create scratch sheet "${SCRATCH}"`, async () => {
        await createScratchSheet(SCRATCH);
        return "Created. It is deleted again at the end of this run.";
      }),
    );
    if (created.status !== "pass") {
      record({
        name: "Write checks",
        status: "skip",
        detail: "Skipped: no scratch sheet, and these must never run on your data.",
      });
      return results;
    }
    scratchReady = true;

    // --- Cross-sheet addressing --------------------------------------------
    // The scratch sheet is not active, so reading it by name exercises the
    // exact path a bank rec needs to see a statement and a cashbook at once.
    const seed: CellValue[][] = [
      ["Label", "Amount", "Formula"],
      ["opening", 1250.5, "=B2*2"],
    ];
    const write = { id: "diag", address: `${SCRATCH}!A1`, note: "diagnostics", values: seed, before: [] };

    record(
      await step("Write literals and a formula in one call", async () => {
        const applied = await applyWrite(write);
        return `Wrote ${seed.length}x${seed[0]!.length} to ${applied.address}.`;
      }),
    );

    record(
      await step("Read it back from a non-active sheet", async () => {
        const res = await excelHost.readRange(`${SCRATCH}!A1:C2`, 50);
        const label = cell(res.values, 1, 0);
        const amount = cell(res.values, 1, 1);
        const computed = cell(res.values, 1, 2);
        if (label !== "opening") throw new Error(`Expected "opening" in A2, got ${JSON.stringify(label)}.`);
        if (amount !== 1250.5) throw new Error(`Expected 1250.5 in B2, got ${JSON.stringify(amount)}.`);
        // The bug this guards: assigning values then formulas blanked the
        // literals. If that regresses, label or amount comes back empty.
        if (computed !== 2501) throw new Error(`Expected the formula to evaluate to 2501, got ${JSON.stringify(computed)}.`);
        return `A2="opening", B2=1250.5, C2=2501 — literals and the live formula all survived.`;
      }),
    );

    record(
      await step("Formula stayed a formula, not a pasted value", async () => {
        const res = await excelHost.readRange(`${SCRATCH}!C2`, 5);
        // readRange returns values; re-read via a write round-trip instead.
        const applied = await applyWrite({
          id: "diag2",
          address: `${SCRATCH}!B2`,
          note: "bump",
          values: [[10]],
          before: [],
        });
        const after = await excelHost.readRange(`${SCRATCH}!C2`, 5);
        const recomputed = cell(after.values, 0, 0);
        await revertWrite(applied);
        if (recomputed !== 20) {
          throw new Error(
            `C2 did not recalculate after B2 changed (got ${JSON.stringify(recomputed)}); it was written as a static value. Prior read: ${JSON.stringify(cell(res.values, 0, 0))}.`,
          );
        }
        return "C2 recalculated when B2 changed — it is a live formula.";
      }),
    );

    // --- Undo ---------------------------------------------------------------
    record(
      await step("Undo restores the previous contents", async () => {
        const target = `${SCRATCH}!A5`;
        const before = await excelHost.readRange(target, 5);
        const applied = await applyWrite({
          id: "diag3",
          address: target,
          note: "undo check",
          values: [["temporary"]],
          before: before.values,
        });
        const during = await excelHost.readRange(target, 5);
        if (cell(during.values, 0, 0) !== "temporary") {
          throw new Error("The value never landed, so undo cannot be judged.");
        }
        await revertWrite(applied);
        const after = await excelHost.readRange(target, 5);
        const restored = cell(after.values, 0, 0);
        if (restored !== null && restored !== "") {
          throw new Error(`A5 should be empty again, but holds ${JSON.stringify(restored)}.`);
        }
        return "Wrote, confirmed, reverted, and the cell is empty again.";
      }),
    );

    // --- The hang guard -----------------------------------------------------
    record(
      await step("Whole-column selection is clipped to the used range", async () => {
        const res = await excelHost.readRange(`${SCRATCH}!A:A`, 5000);
        if (res.totalRows > 1000) {
          throw new Error(
            `A:A returned ${res.totalRows} rows — the used-range clip is not applied, and a real column would hang the pane.`,
          );
        }
        return `A:A clipped to ${res.totalRows} row(s) instead of 1,048,576.`;
      }),
    );

    record(
      await step("Create a chart", async () => {
        const res = await excelHost.createChart({
          dataRange: `${SCRATCH}!A1:B2`,
          chartType: "ColumnClustered",
          title: "Diagnostics",
          seriesBy: "Auto",
          placement: "E5",
          valueAxisTitle: null,
          categoryAxisTitle: null,
        });
        return `Chart "${res.name}" anchored at ${res.anchor}.`;
      }),
    );

    record(
      await step("Create a table", async () => {
        const res = await excelHost.createTable(`${SCRATCH}!A1:C2`, true);
        return `Table created over ${res.address}.`;
      }),
    );
  } finally {
    if (scratchReady) {
      // Cleanup must run even when a check above threw, or the next run finds
      // a stale sheet and the workbook keeps a tab nobody asked for.
      const cleaned = await step(`Remove scratch sheet "${SCRATCH}"`, async () => {
        await deleteScratchSheet(SCRATCH);
        return "Removed. The workbook is as you left it.";
      });
      results.push(cleaned);
      onProgress?.(cleaned);
    }
  }

  return results;
}

export interface Summary {
  passed: number;
  failed: number;
  skipped: number;
}

export function summarizeChecks(checks: Check[]): Summary {
  return {
    passed: checks.filter((c) => c.status === "pass").length,
    failed: checks.filter((c) => c.status === "fail").length,
    skipped: checks.filter((c) => c.status === "skip").length,
  };
}

/**
 * A run that skipped everything proves nothing, and must not read as a pass —
 * this panel exists to give a straight answer about whether Excel works, so
 * "didn't run" has to be its own verdict rather than a green tick.
 */
export function verdict(s: Summary): string {
  if (s.failed > 0) {
    return `${s.failed} check(s) failed. The detail under each one is the actual Office.js error.`;
  }
  if (s.passed === 0) {
    return "Nothing ran, so this proves nothing. Sideload the add-in and run it from the task pane in Excel.";
  }
  if (s.skipped > 0) {
    return `${s.passed} check(s) passed and ${s.skipped} were skipped — the skipped ones are still unproven.`;
  }
  return `All ${s.passed} checks passed. The Excel layer works against this host.`;
}

export function verdictTone(s: Summary): "good" | "bad" | "neutral" {
  if (s.failed > 0) return "bad";
  if (s.passed === 0) return "neutral";
  return "good";
}
