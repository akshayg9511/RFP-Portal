import type { PrismaClient } from "@prisma/client";
import { htsCode, int, list, money, str } from "../../src/lib/parse";
import { readSheet, SOURCES, step } from "./lib";

/**
 * Styles, colourways, variations, images and clean sheets.
 *
 * One row per SKU in the source. A style is the product atom; a colourway is
 * the axis images vary on; a variation is the SKU.
 */

export type StyleSeed = {
  styleNumber: string;
  name: string;
  division: string;
  department: string;
  subDepartment: string;
  planUnits: number | null;
  baselineFob: number | null;
  baselineLanded: number | null;
  buckets: Record<string, number>;
};

/** The five cost components, which map 1:1 onto the template's buckets. */
const BUCKET_COLUMNS: Record<string, string> = {
  "Material Cost": "BASE_MATERIALS",
  "Hardware + Trims Cost": "TRIM_HARDWARE",
  "Product Packaging Cost": "PACKAGING",
  "Crafting Cost": "CRAFTING",
  "Factory OH/Profit Cost": "OVERHEAD_SGA_PROFIT",
};

export async function seedStyles(
  db: PrismaClient,
  planUnits: Map<string, number>,
): Promise<StyleSeed[]> {
  const files = [
    { path: SOURCES.bedding, label: "bedding" },
    { path: SOURCES.bottoms, label: "bottoms" },
  ];

  const seeded: StyleSeed[] = [];

  for (const file of files) {
    const rows = await readSheet(file.path);

    // Group SKU rows by style.
    const byStyle = new Map<string, Record<string, unknown>[]>();
    for (const row of rows) {
      const key = str(row["Style Number"]);
      if (!key) continue;
      const bucket = byStyle.get(key);
      if (bucket) bucket.push(row);
      else byStyle.set(key, [row]);
    }

    for (const [styleNumber, skuRows] of byStyle) {
      // Costs are not comparable across scenarios — prefer Default, else take
      // whatever the rows carry.
      const defaults = skuRows.filter(
        (r) => str(r["Scenario Name"])?.toLowerCase() === "default",
      );
      const costRows = defaults.length ? defaults : skuRows;
      const head = costRows[0];

      const buckets: Record<string, number> = {};
      for (const [column, bucket] of Object.entries(BUCKET_COLUMNS)) {
        buckets[bucket] = median(
          costRows.map((r) => money(r[column])).filter(isNumber),
        );
      }

      const baselineFob =
        median(costRows.map((r) => money(r["Product Cost"])).filter(isNumber)) ||
        null;

      // Baseline LANDED — what Quince pays today delivered, and the only
      // figure a landed Best Cost may be compared against. Stored and
      // displayed, but never compared to a vendor FOB (Build Doc 11.4).
      const baselineLanded =
        median(
          costRows.map((r) => money(r["Shipping and Handling Cost"])).filter(isNumber),
        ) + (baselineFob ?? 0) || null;

      // Bedding's Size Model disagrees with the real SKU set on 36% of styles,
      // so sizes come from the rows. Bottoms matches, but the rows are correct
      // for both, so there is no reason to branch.
      const sizes = new Set(
        skuRows.map((r) => str(r["Size"])).filter((s): s is string => !!s),
      );
      const variationLevel = sizes.size > 1 ? "SIZE" : "STYLE";

      const style = await db.style.create({
        data: {
          styleNumber,
          name: str(head["Internal Product Name"]) ?? styleNumber,
          division: str(head["Division"]) ?? "Unknown",
          department: str(head["Department"]) ?? "Unknown",
          subDepartment: str(head["Sub Department"]) ?? "Unknown",
          subClass: str(head["Sub Class"]),
          material: str(head["Material"]),
          productType: str(head["Product Type"]),
          franchise: str(head["Product Franchise"]),
          gender: str(head["Gender"]),
          variationLevel,
          websiteUrl: str(head["Website Link"]),
          sizeModel: str(head["Size Model"]),
          scenarioName: str(head["Scenario Name"]),
          scenarioId: str(head["Scenario ID"]),
          retailPrice: money(head["Retail Price"]),
          htsCode: htsCode(head["Hs Code"]),
          lengthIn: money(head["Length"]),
          widthIn: money(head["Width"]),
          heightIn: money(head["Height"]),
          weightG: money(head["Weight"]),
          planUnits: planUnits.get(styleNumber) ?? null,
          baselineFob,
          baselineLanded,
        },
      });

      // Colourways, then images keyed to them. Images vary by colour, not size.
      const byColour = new Map<string, Record<string, unknown>[]>();
      for (const row of skuRows) {
        const colourId = str(row["Style Color ID"]);
        if (!colourId) continue;
        const bucket = byColour.get(colourId);
        if (bucket) bucket.push(row);
        else byColour.set(colourId, [row]);
      }

      const colourwayIds = new Map<string, string>();
      for (const [styleColorId, colourRows] of byColour) {
        const first = colourRows[0];
        const colourway = await db.colourway.create({
          data: {
            styleId: style.id,
            styleColorId,
            name: str(first["Color"]) ?? "Default",
            websiteUrl: str(first["Website Link"]),
          },
        });
        colourwayIds.set(styleColorId, colourway.id);

        // Hero first, then the additional images, deduped and ordered.
        const urls: string[] = [];
        const hero = str(first["Thumbnail Link"]);
        if (hero) urls.push(hero);
        for (const row of colourRows) {
          const thumb = str(row["Thumbnail Link"]);
          if (thumb) urls.push(thumb);
          urls.push(...list(row["Additional Image Links"]));
        }

        const unique = [...new Set(urls)];
        if (unique.length) {
          await db.styleImage.createMany({
            data: unique.map((url, i) => ({
              styleId: style.id,
              colourwayId: colourway.id,
              url,
              isHero: i === 0,
              position: i,
            })),
          });
        }
      }

      // Variations — one per SKU.
      const totalUnits = planUnits.get(styleNumber) ?? 0;
      const share = skuRows.length ? 1 / skuRows.length : 0;
      await db.variation.createMany({
        data: skuRows.map((row) => ({
          styleId: style.id,
          colourwayId: colourwayIds.get(str(row["Style Color ID"]) ?? "") ?? null,
          size: str(row["Size"]),
          sizeSortOrder: int(row["Size Sort Order"]),
          colour: str(row["Color"]),
          sku: str(row["SKU"]),
          planUnits: totalUnits ? Math.round(totalUnits * share) : null,
          volumeShare: share,
          baselineFob: money(row["Product Cost"]),
        })),
      });

      // BOTH cost splits are stored. The baseline is the real per-bucket cost
      // from the catalogue; the clean sheet is that structure with a per-bucket
      // should-cost discount. Storing only the clean sheet meant the drawer had
      // to reverse-derive baseline by scaling it, which forces every bucket to
      // an identical gap — the per-bucket discounts below became invisible.
      const live = Object.entries(buckets).filter(([, amount]) => amount > 0);

      await db.cleanSheet.createMany({
        data: [
          ...live.map(([bucket, amount]) => ({
            styleId: style.id,
            kind: "BASELINE",
            bucket,
            amount,
          })),
          ...live.map(([bucket, amount]) => ({
            styleId: style.id,
            kind: "CLEAN_SHEET",
            bucket,
            amount: amount * CLEAN_SHEET_DISCOUNT[bucket],
          })),
        ],
      });

      seeded.push({
        styleNumber,
        name: style.name,
        division: style.division,
        department: style.department,
        subDepartment: style.subDepartment,
        planUnits: style.planUnits,
        baselineFob,
        baselineLanded,
        buckets,
      });
    }

    step(`${file.label}: ${byStyle.size} styles`);
  }

  return seeded;
}

/**
 * Per-bucket should-cost discount. Materials and crafting carry the most
 * negotiable headroom; packaging almost none. Held here rather than in code
 * elsewhere so it retunes in one place.
 */
const CLEAN_SHEET_DISCOUNT: Record<string, number> = {
  BASE_MATERIALS: 0.86,
  TRIM_HARDWARE: 0.9,
  PACKAGING: 0.95,
  CRAFTING: 0.82,
  OVERHEAD_SGA_PROFIT: 0.88,
};

function isNumber(v: number | null): v is number {
  return v !== null;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
