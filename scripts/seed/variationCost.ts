/**
 * PER-VARIATION COST — clean sheets and current-supplier prices per size.
 *
 * Why this exists: a dropdown over the Cost breakdown that leaves every
 * bucket unchanged reads as broken. Before 1.5, CleanSheet and
 * CurrentSupplier were keyed on styleId alone, so all five sizes of a sheet
 * set shared one cost split.
 *
 * WHAT MAKES IT HONEST: the per-variation figures are not invented. Each
 * variation already carries its own real `baselineFob` from the catalogue —
 * $53.90 to $100.01 across U-BEDD-33's sizes — so scaling the style's
 * buckets by `variation.baselineFob / style.baselineFob` gives a King that
 * costs more than a Twin in the same proportion the source data says it
 * does. The bucket MIX is assumed constant across sizes, which is the one
 * approximation here and a reasonable one: a bigger sheet uses more of
 * everything.
 *
 * The style-level rows stay exactly as they were (variationId NULL), so
 * anything reading at style level is unaffected.
 */

import type { PrismaClient } from "@prisma/client";
import { variationKeyOf } from "../../src/domain/grain";

/** Keeps money to cents; Decimal(12,4) stores more but nobody quotes it. */
function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export async function seedVariationCost(db: PrismaClient): Promise<{
  cleanSheetRows: number;
  supplierRows: number;
  styles: number;
}> {
  const styles = await db.style.findMany({
    select: {
      id: true,
      baselineFob: true,
      variations: { select: { id: true, baselineFob: true } },
      cleanSheets: {
        where: { variationId: null },
        select: { kind: true, bucket: true, lineItem: true, amount: true },
      },
      currentSuppliers: {
        where: { variationId: null },
        select: { vendorId: true, currentFob: true },
      },
    },
  });

  let cleanSheetRows = 0;
  let supplierRows = 0;
  let touched = 0;

  for (const style of styles) {
    const styleFob = Number(style.baselineFob ?? 0);
    // Without a style baseline there is no ratio to scale by, and inventing
    // one would put fabricated money on screen.
    if (!styleFob || !style.variations.length) continue;

    // Scale from the BUCKET SUM, not the declared baseline.
    //
    // 16 of 82 styles have style-level buckets that do not sum to their own
    // baselineFob — a pre-existing seed defect that was never gated
    // (U-BEDD-174: buckets $52.54 against a $49.19 baseline). Scaling by
    // varFob/styleFob faithfully reproduces that gap at every size, so the
    // drawer would show a breakdown whose total disagrees with the headline
    // figure beside it.
    //
    // Dividing by the bucket sum instead makes each variation's buckets sum
    // to ITS baselineFob exactly. The bucket MIX is preserved; only the
    // scale is corrected. The style-level rows are left untouched, so this
    // fixes the new data without silently rewriting what the demo already
    // shows.
    const baselineSum = style.cleanSheets
      .filter((row) => row.kind === "BASELINE")
      .reduce((total, row) => total + Number(row.amount), 0);
    const cleanSum = style.cleanSheets
      .filter((row) => row.kind !== "BASELINE")
      .reduce((total, row) => total + Number(row.amount), 0);

    const cleanRows: {
      styleId: string;
      variationId: string;
      variationKey: string;
      kind: string;
      bucket: string;
      lineItem: string | null;
      amount: number;
    }[] = [];
    const supplierRowsData: {
      styleId: string;
      vendorId: string;
      variationId: string;
      variationKey: string;
      currentFob: number | null;
    }[] = [];

    for (const variation of style.variations) {
      const varFob = Number(variation.baselineFob ?? 0);
      // A variation with no cost of its own inherits the style's, so the
      // target is the style's own figure rather than 0 — scaling to 0 would
      // zero every bucket.
      const target = varFob || styleFob;
      const key = variationKeyOf(variation.id);

      for (const row of style.cleanSheets) {
        const isBaseline = row.kind === "BASELINE";
        const sum = isBaseline ? baselineSum : cleanSum;
        if (!sum) continue;
        // Baseline buckets scale to the variation's FOB. Clean-sheet buckets
        // scale by the SAME factor, which preserves the per-bucket
        // should-cost discount rather than forcing the clean sheet to equal
        // the baseline.
        const factor = isBaseline
          ? target / sum
          : target / baselineSum || 0;
        cleanRows.push({
          styleId: style.id,
          variationId: variation.id,
          variationKey: key,
          kind: row.kind,
          bucket: row.bucket,
          lineItem: row.lineItem,
          amount: round4(Number(row.amount) * factor),
        });
      }

      for (const supplier of style.currentSuppliers) {
        supplierRowsData.push({
          styleId: style.id,
          vendorId: supplier.vendorId,
          variationId: variation.id,
          variationKey: key,
          currentFob:
            supplier.currentFob === null
              ? null
              : round4(
                  Number(supplier.currentFob) * (styleFob ? target / styleFob : 1),
                ),
        });
      }
    }

    if (cleanRows.length) {
      await db.cleanSheet.createMany({ data: cleanRows });
      cleanSheetRows += cleanRows.length;
    }
    if (supplierRowsData.length) {
      await db.currentSupplier.createMany({ data: supplierRowsData });
      supplierRows += supplierRowsData.length;
    }
    touched++;
  }

  return { cleanSheetRows, supplierRows, styles: touched };
}
