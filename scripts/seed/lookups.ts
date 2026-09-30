import type { PrismaClient } from "@prisma/client";
import ExcelJS from "exceljs";
import { htsCode, int, money, str } from "../../src/lib/parse";
import { readSheet, SOURCES, step } from "./lib";

/**
 * Plan units per style, summed across the 12 monthly columns.
 *
 * Read POSITIONALLY, not by header: all twelve months use the identical header
 * text "Plan Units" (row 3) with the month on row 2, so a header-keyed read
 * collapses them to one column and silently returns a single month's figure
 * instead of the year. That understated every award dollar in the wave by ~10x.
 */
export async function readPlanUnits(): Promise<Map<string, number>> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(SOURCES.wave1);
  const ws = wb.getWorksheet("FY26 Plan Data");
  if (!ws) throw new Error("FY26 Plan Data sheet not found");

  // Locate the Plan Units columns from the metric header row.
  const unitCols: number[] = [];
  ws.getRow(3).eachCell({ includeEmpty: true }, (cell, col) => {
    if (String(cell.value ?? "").trim().toLowerCase() === "plan units") {
      unitCols.push(col);
    }
  });
  if (unitCols.length === 0) throw new Error("No Plan Units columns found");

  const out = new Map<string, number>();
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber <= 3) return;
    const style = str(row.getCell(1).value);
    if (!style) return;

    let total = 0;
    for (const col of unitCols) total += int(row.getCell(col).value) ?? 0;
    if (total > 0) out.set(style, total);
  });

  step(`plan units for ${out.size} styles (${unitCols.length} monthly columns)`);
  return out;
}

/** Tariff: HTSUS x ISO, pivoted from a wide matrix into rows. */
export async function seedTariff(db: PrismaClient): Promise<number> {
  const rows = await readSheet(SOURCES.wave1, "Master Data - Tariff");
  const data: { htsCode: string; countryIso: string; rate: number }[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const hts = htsCode(row["HTSUS"]);
    if (!hts) continue;

    for (const [key, value] of Object.entries(row)) {
      if (key === "HTSUS") continue;
      // ISO country columns are exactly two letters.
      if (!/^[A-Z]{2}$/.test(key.trim())) continue;

      const rate = money(value);
      if (rate === null) continue;

      const dedupe = `${hts}|${key.trim()}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);

      data.push({ htsCode: hts, countryIso: key.trim(), rate });
    }
  }

  for (let i = 0; i < data.length; i += 2000) {
    await db.tariffRate.createMany({ data: data.slice(i, i + 2000) });
  }

  step(`${data.length} tariff rates`);
  return data.length;
}

/**
 * Logistics per style+size, plus a COO median fallback.
 *
 * Only 51 of 82 styles have a real rate and only 44 of 277 (style,size) pairs
 * match exactly, so the median is what keeps landed cost sane for the rest.
 */
export async function seedLogistics(db: PrismaClient): Promise<{
  count: number;
  cooMedian: Map<string, { ocean: number; air: number }>;
}> {
  const rows = await readSheet(SOURCES.wave1, "Master Data - Logistics");

  const data: {
    styleNumber: string;
    size: string | null;
    countryIso: string | null;
    ocean: number | null;
    air: number | null;
  }[] = [];
  const byCoo = new Map<string, { ocean: number[]; air: number[] }>();

  for (const row of rows) {
    const key = str(row["Style+Size Key"]);
    if (!key) continue;

    const [stylePart, sizePart] = key.toLowerCase().split("|");
    const ocean = money(row["Logistics Ocean ($/unit)"]);
    const air = money(row["Logistics Air ($/unit)"]);
    const iso = str(row["COO Code"]);

    data.push({
      styleNumber: stylePart.trim().toUpperCase(),
      size: sizePart?.trim() || null,
      countryIso: iso,
      ocean,
      air,
    });

    if (iso && ocean !== null && air !== null) {
      const bucket = byCoo.get(iso) ?? { ocean: [], air: [] };
      bucket.ocean.push(ocean);
      bucket.air.push(air);
      byCoo.set(iso, bucket);
    }
  }

  for (let i = 0; i < data.length; i += 2000) {
    await db.logisticsRate.createMany({ data: data.slice(i, i + 2000) });
  }

  const cooMedian = new Map<string, { ocean: number; air: number }>();
  for (const [iso, v] of byCoo) {
    cooMedian.set(iso, { ocean: median(v.ocean), air: median(v.air) });
  }

  step(`${data.length} logistics rates · ${cooMedian.size} COO medians`);
  return { count: data.length, cooMedian };
}

/**
 * Every tuning constant. Held here, not in code, so band cutoffs and guardrail
 * thresholds retune without a release (Build Doc 8.3, 11.8).
 */
export async function seedConfig(
  db: PrismaClient,
  cooMedian: Map<string, { ocean: number; air: number }>,
): Promise<void> {
  const entries: { key: string; value: unknown }[] = [
    // Air/ocean blend — a constant per wave (Build Doc 11.4).
    { key: "blend.air", value: 0.7 },
    { key: "blend.ocean", value: 0.3 },

    // Competitiveness bands. s = (baseline - bid) / (baseline - cleanSheet).
    {
      key: "bands.competitiveness",
      value: { strong: 0.6, competitive: 0.35, needsWork: 0.1 },
    },
    // How far above the clean sheet's bucket target reads as "above".
    { key: "bands.bucketFlag", value: { above: 0.1, below: -0.1 } },

    // COO guardrails — a RANGE per region, min to max.
    //
    // A region can be wrong in two directions: too concentrated (the Wave 1
    // problem) or too thin to be a real second source. A single threshold
    // cannot express that, and a region with no maximum could absorb the whole
    // wave without ever flagging.
    //
    // The specified bounds are business rules. The open end of each range is
    // derived from what the region can actually SUPPLY, measured as bidding
    // presence across the wave's bid styles — a region serving 3 of 10 styles
    // cannot credibly take half the wave:
    //
    //   CHINA 10/10 · ISC 9/10 · SEA 7/10 · EMEA 6/10 · AMERICAS 3/10
    //
    // Over-max is actionable from one style and shows on the playground rail.
    // Under-min is a wave-level target and shows only in Wave Insights.
    // Neither blocks a save (Build Doc 11.8).
    {
      key: "guardrails.coo",
      value: {
        CHINA: { min: 0, max: 0.3 },
        ISC: { min: 0, max: 0.3 },
        SEA: { min: 0.3, max: 0.6 },
        AMERICAS: { min: 0.07, max: 0.2 },
        EMEA: { min: 0.03, max: 0.2 },
      },
    },
    // Spend caps, per vendor in total. Type is frozen at wave start.
    {
      key: "guardrails.vendorSpendCap",
      value: { incumbentOrExisting: 20_000_000, new: 10_000_000 },
    },

    // Scenario 3's incumbent/new ratio — configurable (70/30 -> 60/40 -> 50/50).
    { key: "scenarios.ratio", value: { incumbent: 0.7, new: 0.3 } },

    // Fallback logistics, so a style with no rate still lands a real number.
    {
      key: "logistics.cooMedian",
      value: Object.fromEntries(cooMedian),
    },

    { key: "wave.dutyDestinations", value: ["US_WEST", "US_CENTRAL", "US_EAST"] },
  ];

  for (const entry of entries) {
    await db.config.create({
      data: { key: entry.key, value: entry.value as never },
    });
  }

  step(`${entries.length} config entries`);
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
