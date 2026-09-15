/**
 * The live Excel implementation of Host.
 *
 * Structural types again, deliberately: CI has no Office host, and the ambient
 * @microsoft/office-js globals do not type-check without one. The real
 * Excel.OfficeExtension objects satisfy these shapes at runtime.
 *
 * Two rules this file exists to enforce:
 *   1. Every read is intersected with the used range. A user clicking a column
 *      header selects 1,048,576 rows, and marshalling that across the Office.js
 *      bridge hangs the task pane.
 *   2. Writes go through `formulas` alone, never `values` and `formulas` in the
 *      same sync. Assigning both applies the second over the whole rectangle,
 *      blanking every cell the first one filled.
 */

import { columnLetter, splitAddress, startColumnOf, startRowOf } from "./executor.js";
import type {
  CellValue,
  ChartSpec,
  Host,
  PendingWrite,
  RawSheetContext,
  ReadResult,
} from "./executor.js";

interface Loadable {
  load(props: string): void;
}

interface RangeLike extends Loadable {
  address: string;
  rowIndex: number;
  columnIndex: number;
  rowCount: number;
  columnCount: number;
  values: CellValue[][];
  formulas: Array<Array<string | number | null>>;
  isNullObject?: boolean;
  getIntersectionOrNullObject(other: RangeLike): RangeLike;
  getFormat(): { autofitColumns(): void };
}

interface SheetLike extends Loadable {
  name: string;
  getUsedRangeOrNullObject(): RangeLike;
  getRange(address: string): RangeLike;
  getRangeByIndexes(row: number, col: number, rows: number, cols: number): RangeLike;
  tables: { load(p: string): void; items: Array<{ name: string; getRange(): RangeLike }> };
  charts: {
    add(type: string, source: RangeLike, seriesBy: string): ChartLike;
  };
  delete(): void;
  activate(): void;
}

interface ChartLike extends Loadable {
  name: string;
  title: { text: string };
  axes: {
    valueAxis: { title: { text: string } };
    categoryAxis: { title: { text: string } };
  };
  setPosition(topLeft: RangeLike, bottomRight: RangeLike): void;
}

interface ContextLike {
  workbook: {
    worksheets: {
      getActiveWorksheet(): SheetLike;
      getItem(name: string): SheetLike;
      getItemOrNullObject(name: string): SheetLike & { isNullObject?: boolean };
      add(name?: string): SheetLike;
      load(props: string): void;
      items: Array<{ name: string; position: number }>;
    };
    getSelectedRange(): RangeLike;
    tables: { add(range: RangeLike, hasHeaders: boolean): { name: string; getRange(): RangeLike } };
  };
  sync(): Promise<unknown>;
}

interface ExcelLike {
  run<T>(cb: (ctx: ContextLike) => Promise<T>): Promise<T>;
}

/** The Excel namespace, or null when running as a plain web page. */
export function getExcel(): ExcelLike | null {
  const g = globalThis as { Excel?: ExcelLike };
  return g.Excel ?? null;
}

export function isInExcel(): boolean {
  return getExcel() !== null;
}

function excelOrThrow(): ExcelLike {
  const e = getExcel();
  if (!e) {
    throw new Error("Not running inside Excel, so the worksheet is unavailable.");
  }
  return e;
}

/** Bounded read: clip to the used range, then cap rows. */
function clip(
  sheet: SheetLike,
  target: RangeLike,
  used: RangeLike,
  maxRows: number,
): { range: RangeLike; totalRows: number; truncated: boolean } | null {
  if (used.isNullObject) return null;
  const top = Math.max(target.rowIndex, used.rowIndex);
  const left = Math.max(target.columnIndex, used.columnIndex);
  const bottom = Math.min(target.rowIndex + target.rowCount, used.rowIndex + used.rowCount);
  const right = Math.min(target.columnIndex + target.columnCount, used.columnIndex + used.columnCount);
  const totalRows = bottom - top;
  const cols = right - left;
  if (totalRows <= 0 || cols <= 0) return null;
  const rows = Math.min(totalRows, maxRows);
  return {
    range: sheet.getRangeByIndexes(top, left, rows, cols),
    totalRows,
    truncated: rows < totalRows,
  };
}

const USED_PROPS = "address,rowIndex,columnIndex,rowCount,columnCount,isNullObject";

/**
 * Resolve the worksheet an address names, falling back to the active one.
 * Everything that touches a range goes through here, so a cross-sheet
 * reconciliation reads the sheet it asked for rather than whatever tab
 * happened to be in front.
 */
function sheetFor(ctx: ContextLike, address: string): { sheet: SheetLike; cell: string } {
  const { sheet, cell } = splitAddress(address);
  return {
    sheet: sheet ? ctx.workbook.worksheets.getItem(sheet) : ctx.workbook.worksheets.getActiveWorksheet(),
    cell,
  };
}

export const excelHost: Host = {
  async getSheetContext(sampleRows: number): Promise<RawSheetContext> {
    return excelOrThrow().run(async (ctx) => {
      const sheet = ctx.workbook.worksheets.getActiveWorksheet();
      sheet.load("name");
      const used = sheet.getUsedRangeOrNullObject();
      used.load(USED_PROPS);
      const selection = ctx.workbook.getSelectedRange();
      selection.load("address");
      sheet.tables.load("items/name");
      await ctx.sync();

      if (used.isNullObject) {
        return {
          sheetName: sheet.name,
          usedRangeAddress: null,
          rowCount: 0,
          columnCount: 0,
          selectionAddress: selection.address ?? null,
          sample: [],
          tables: [],
        };
      }

      const rows = Math.min(used.rowCount, Math.max(sampleRows, 1));
      const sample = sheet.getRangeByIndexes(used.rowIndex, used.columnIndex, rows, used.columnCount);
      sample.load("values");
      const tableRanges = sheet.tables.items.map((t) => {
        const r = t.getRange();
        r.load("address");
        return { name: t.name, range: r };
      });
      await ctx.sync();

      return {
        sheetName: sheet.name,
        usedRangeAddress: used.address,
        rowCount: used.rowCount,
        columnCount: used.columnCount,
        selectionAddress: selection.address ?? null,
        sample: sample.values ?? [],
        tables: tableRanges.map((t) => ({ name: t.name, address: t.range.address })),
      };
    });
  },

  async listSheets(): Promise<Array<{ name: string; position: number }>> {
    return excelOrThrow().run(async (ctx) => {
      ctx.workbook.worksheets.load("items/name,items/position");
      await ctx.sync();
      return ctx.workbook.worksheets.items.map((s) => ({ name: s.name, position: s.position }));
    });
  },

  async readRange(address: string, maxRows: number): Promise<ReadResult> {
    return excelOrThrow().run(async (ctx) => {
      const { sheet, cell } = sheetFor(ctx, address);
      const target = sheet.getRange(cell);
      target.load("address,rowIndex,columnIndex,rowCount,columnCount");
      const used = sheet.getUsedRangeOrNullObject();
      used.load(USED_PROPS);
      await ctx.sync();

      const clipped = clip(sheet, target, used, maxRows);
      if (!clipped) {
        return { address: target.address, values: [], truncated: false, totalRows: 0 };
      }
      clipped.range.load("address,values");
      await ctx.sync();
      return {
        address: clipped.range.address,
        values: clipped.range.values ?? [],
        truncated: clipped.truncated,
        totalRows: clipped.totalRows,
      };
    });
  },

  async createChart(spec: ChartSpec): Promise<{ name: string; anchor: string }> {
    return excelOrThrow().run(async (ctx) => {
      const { sheet, cell } = sheetFor(ctx, spec.dataRange);
      const data = sheet.getRange(cell);
      data.load("rowIndex,columnIndex,rowCount,columnCount");
      await ctx.sync();

      const chart = sheet.charts.add(spec.chartType, data, spec.seriesBy);
      chart.title.text = spec.title;

      // Default to just right of the data, with a gap, so the chart never
      // covers the numbers it describes.
      const anchorCell =
        spec.placement ??
        `${columnLetter(data.columnIndex + data.columnCount + 1)}${data.rowIndex + 1}`;
      const anchor = sheet.getRange(anchorCell);
      // A chart smaller than this is unreadable; 8 columns x 15 rows is roughly
      // the 480x288 Excel uses for a default chart.
      const bottomRight = sheet.getRangeByIndexes(
        startRowOf(anchorCell),
        startColumnOf(anchorCell),
        15,
        8,
      );
      chart.setPosition(anchor, bottomRight);

      if (spec.valueAxisTitle) {
        chart.axes.valueAxis.title.text = spec.valueAxisTitle;
      }
      if (spec.categoryAxisTitle) {
        chart.axes.categoryAxis.title.text = spec.categoryAxisTitle;
      }
      chart.load("name");
      await ctx.sync();
      return { name: chart.name, anchor: anchorCell };
    });
  },

  async createTable(address: string, hasHeaders: boolean): Promise<{ address: string }> {
    return excelOrThrow().run(async (ctx) => {
      const { sheet, cell } = sheetFor(ctx, address);
      const range = sheet.getRange(cell);
      const table = ctx.workbook.tables.add(range, hasHeaders);
      const created = table.getRange();
      created.load("address");
      await ctx.sync();
      return { address: created.address };
    });
  },
};

/** What the user can put back if they change their mind. */
export interface AppliedWrite {
  address: string;
  /** Formulas as they were before we overwrote them. */
  priorFormulas: Array<Array<string | number | null>>;
}

/**
 * Apply a staged write, after the user accepted it.
 *
 * Values and formulas go through a single `formulas` assignment: Office treats
 * a plain literal in that array as a literal, and a leading "=" as a live
 * formula, so one array covers both without the two-assignment clobber.
 */
export async function applyWrite(write: PendingWrite): Promise<AppliedWrite> {
  return excelOrThrow().run(async (ctx) => {
    const { sheet, cell } = sheetFor(ctx, write.address);
    const height = write.values.length;
    const width = write.values[0]?.length ?? 0;
    const anchor = sheet.getRange(cell);
    anchor.load("rowIndex,columnIndex");
    await ctx.sync();

    const dest = sheet.getRangeByIndexes(anchor.rowIndex, anchor.columnIndex, height, width);
    dest.load("address,formulas");
    await ctx.sync();
    const priorFormulas = dest.formulas ?? [];

    dest.formulas = write.values.map((row) =>
      Array.from({ length: width }, (_, i) => {
        const v = row[i];
        return v === null || v === undefined ? "" : typeof v === "boolean" ? String(v) : v;
      }),
    );
    dest.getFormat().autofitColumns();
    await ctx.sync();

    return { address: dest.address, priorFormulas };
  });
}

/** Restore the formulas captured before a write. */
export async function revertWrite(applied: AppliedWrite): Promise<void> {
  await excelOrThrow().run(async (ctx) => {
    const { sheet, cell } = sheetFor(ctx, applied.address);
    sheet.getRange(cell).formulas = applied.priorFormulas;
    await ctx.sync();
  });
}

/**
 * Diagnostics helpers. These are NOT exposed as tools — the model cannot
 * create or delete worksheets. They exist so the self-check can do its work in
 * a scratch sheet and remove it afterwards, rather than writing into data
 * somebody is reconciling.
 */
export async function createScratchSheet(name: string): Promise<void> {
  await excelOrThrow().run(async (ctx) => {
    const existing = ctx.workbook.worksheets.getItemOrNullObject(name);
    existing.load("isNullObject");
    await ctx.sync();
    if (!existing.isNullObject) existing.delete();
    ctx.workbook.worksheets.add(name);
    await ctx.sync();
  });
}

export async function deleteScratchSheet(name: string): Promise<void> {
  await excelOrThrow().run(async (ctx) => {
    const sheet = ctx.workbook.worksheets.getItemOrNullObject(name);
    sheet.load("isNullObject");
    await ctx.sync();
    if (!sheet.isNullObject) {
      sheet.delete();
      await ctx.sync();
    }
  });
}
