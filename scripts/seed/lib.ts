import path from "node:path";
import ExcelJS from "exceljs";

/** Where the source workbooks live, relative to the repo. */
export const DATA_ROOT = path.resolve(process.cwd(), "..", "Data");

export const SOURCES = {
  bedding: path.join(
    DATA_ROOT,
    "product Catalog/Filtered list with product URL/Filtered-home-bedding-with-images-and-vendors.xlsx",
  ),
  bottoms: path.join(
    DATA_ROOT,
    "product Catalog/Filtered list with product URL/filtered-women-bottoms-with-images-and-vendors.xlsx",
  ),
  wave1: path.join(
    DATA_ROOT,
    "Wave 1 tracker sheet/Wave 1 RFP Summary - May (5).xlsx",
  ),
  templatePonte: path.join(
    DATA_ROOT,
    "product Catalog/Bidding template/Bidding Template - Ponte (Radnik).xlsx",
  ),
  templatePercale: path.join(
    DATA_ROOT,
    "product Catalog/Bidding template/Lauren Home - R1 - Percale - bid template v1 (1).xlsx",
  ),
} as const;

/**
 * Deterministic RNG (mulberry32). Generated data must be identical on every
 * run — a demo that shows different numbers the second time is not
 * reproducible, which is the whole point of seeding rather than mocking.
 */
export function rng(seed = 20260913) {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(next: () => number, items: readonly T[]): T {
  return items[Math.floor(next() * items.length) % items.length];
}

/** Uniform float in [min, max). */
export function between(next: () => number, min: number, max: number): number {
  return min + next() * (max - min);
}

export function round(value: number, dp = 4): number {
  const f = 10 ** dp;
  return Math.round(value * f) / f;
}

/**
 * Read a worksheet into row objects keyed by header name.
 * `headerRow` is 1-indexed, matching how the files are actually laid out.
 */
export async function readSheet(
  file: string,
  sheetName?: string,
  headerRow = 1,
): Promise<Record<string, unknown>[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);

  const ws = sheetName ? wb.getWorksheet(sheetName) : wb.worksheets[0];
  if (!ws) {
    throw new Error(`Sheet ${sheetName ?? "[first]"} not found in ${file}`);
  }

  const headers: string[] = [];
  ws.getRow(headerRow).eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col] = String(cell.value ?? "").trim();
  });

  const out: Record<string, unknown>[] = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber <= headerRow) return;

    const record: Record<string, unknown> = {};
    let hasValue = false;
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      const key = headers[col];
      if (!key) return;
      // A formula cell carries { formula, result } — take the computed value.
      const v =
        cell.value !== null &&
        typeof cell.value === "object" &&
        "result" in cell.value
          ? (cell.value as { result?: unknown }).result
          : cell.value;
      record[key] = v;
      if (v !== null && v !== undefined && v !== "") hasValue = true;
    });

    if (hasValue) out.push(record);
  });

  return out;
}

/** Progress line, so a long seed does not look hung. */
export function step(message: string): void {
  process.stdout.write(`  ${message}\n`);
}
