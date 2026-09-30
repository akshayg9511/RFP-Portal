import { computeQuote } from "../../src/domain/quote";
import { between, round, type rng } from "./lib";

/**
 * Reconstruct a vendor's line items from their bucket totals.
 *
 * The seed used to write `values: {generated: true}` and a stored FOB, so
 * opening a seeded quote showed an EMPTY form while the dashboard showed a
 * price — two sources of truth for one number, and a form that looked broken.
 *
 * This inverts each template's formula to hit a known bucket total exactly, so
 * every seeded bid opens as a filled sheet that recomputes to the FOB it was
 * seeded with. The numbers are invented but internally consistent, which is
 * what makes a bid inspectable.
 */

export type Buckets = {
  BASE_MATERIALS: number;
  TRIM_HARDWARE: number;
  PACKAGING: number;
  CRAFTING: number;
  OVERHEAD_SGA_PROFIT: number;
};

/**
 * Overhead of zero is not credible — no vendor quotes at no margin — and the
 * catalogue's Factory OH/Profit column is 0 for some styles, which
 * scaleBuckets faithfully scaled to zero. Floor it to a realistic share of
 * FOB and take the difference out of materials, so the buckets still sum to
 * exactly the FOB.
 */
export function floorOverhead(
  buckets: Buckets,
  next: () => number,
  minShare = 0.06,
): Buckets {
  const fob = Object.values(buckets).reduce((s, v) => s + v, 0);
  if (fob <= 0) return buckets;

  const minimum = fob * minShare;
  if (buckets.OVERHEAD_SGA_PROFIT >= minimum) return buckets;

  const target = round(fob * between(next, minShare, minShare + 0.05), 4);
  const shortfall = target - buckets.OVERHEAD_SGA_PROFIT;

  return {
    ...buckets,
    // Materials is the largest bucket, so it absorbs the shift with the least
    // distortion to the others.
    BASE_MATERIALS: round(buckets.BASE_MATERIALS - shortfall, 4),
    OVERHEAD_SGA_PROFIT: target,
  };
}

/**
 * Line items that compute to `buckets`, for the Percale (bedding) template:
 *   material = consumption * (grey + dye + print) * (1 + wastage)
 *   crafting = rate / efficiency * SAM
 */
function percaleLines(buckets: Buckets, next: () => number) {
  // Materials: pick a plausible consumption and wastage, then solve for the
  // per-meter costs that land the target.
  const consumption = round(between(next, 2.2, 5.5), 2);
  const wastage = round(between(next, 3, 8), 1);
  const otherMaterials = round(buckets.BASE_MATERIALS * between(next, 0.02, 0.06), 2);
  const core = buckets.BASE_MATERIALS - otherMaterials;
  const perMeter = core / (consumption * (1 + wastage / 100));
  // Split the per-meter cost across grey, dyeing and printing.
  const grey = round(perMeter * 0.62, 4);
  const dyeing = round(perMeter * 0.28, 4);
  const printing = round(perMeter - grey - dyeing, 4);

  // Crafting: a real CPM and efficiency, solve for SAM.
  const rate = round(between(next, 0.08, 0.14), 3);
  const efficiency = round(between(next, 78, 95), 0);
  const other = round(buckets.CRAFTING * between(next, 0.03, 0.1), 2);
  const sam = round(((buckets.CRAFTING - other) * (efficiency / 100)) / rate, 1);

  return {
    fabric: "100% Organic Cotton 50's x 50's",
    fabricWidth: 2.8,
    consumption,
    greyCostPerMeter: grey,
    dyeingCostPerMeter: dyeing,
    printingCostPerMeter: printing,
    wastage,
    otherMaterialsDescription: otherMaterials > 0 ? "Interlining, labels" : "",
    otherMaterialsCost: otherMaterials,
    materialSourceVendor: "Mill partner",
    materialSourceCountry: "—",
    materialLeadTime: Math.round(between(next, 25, 60)),

    directLaborRate: rate,
    lineEfficiency: efficiency,
    sam,
    embellishingCost: 0,
    otherCraftingCost: other,

    overheadCost: round(buckets.OVERHEAD_SGA_PROFIT, 4),
    productLeadTime: Math.round(between(next, 30, 75)),
  } as Record<string, number | string>;
}

/**
 * Line items for the Ponte (bottoms) template:
 *   material = consumption * cost/UoM * (1 + grading + production)
 *   crafting = hourly / 60 * SUM(cutting, sewing, finishing SAM)
 */
function ponteLines(buckets: Buckets, next: () => number) {
  const consumption = round(between(next, 0.9, 2.2), 2);
  const grading = round(between(next, 2, 5), 1);
  const production = round(between(next, 3, 7), 1);
  const otherMaterials = round(buckets.BASE_MATERIALS * between(next, 0.02, 0.06), 2);
  const core = buckets.BASE_MATERIALS - otherMaterials;
  const costPerUom = round(
    core / (consumption * (1 + grading / 100 + production / 100)),
    4,
  );

  // Hourly wage, then split SAM across the three operations.
  const hourlyWage = round(between(next, 3.2, 6.5), 2);
  const wash = round(buckets.CRAFTING * between(next, 0.05, 0.15), 2);
  const totalSam = round(((buckets.CRAFTING - wash) * 60) / hourlyWage, 1);
  const cutting = round(totalSam * 0.18, 1);
  const finishing = round(totalSam * 0.16, 1);
  const sewing = round(totalSam - cutting - finishing, 1);

  return {
    coreMaterial: "Ponte knit",
    uom: "Yard (yd)",
    consumption,
    costPerUom,
    wastageGrading: grading,
    wastageProduction: production,
    otherMaterialsDescription: otherMaterials > 0 ? "Pocketing, labels" : "",
    otherMaterialsCost: otherMaterials,
    materialLeadTime: Math.round(between(next, 20, 55)),

    hourlyWage,
    cuttingSam: cutting,
    sewingSam: sewing,
    finishingSam: finishing,
    washCost: wash,
    otherCraftingCost: 0,

    overheadCost: round(buckets.OVERHEAD_SGA_PROFIT, 4),
    productLeadTime: Math.round(between(next, 30, 70)),
  } as Record<string, number | string>;
}

/**
 * Spread a bucket total across the template's own line keys, so the trim and
 * packaging sections are filled rather than blank.
 */
function spread(
  total: number,
  keys: string[],
  next: () => number,
): Record<string, number> {
  if (!keys.length || total <= 0) return {};
  // Random weights, normalised, so the lines sum to the total exactly.
  const weights = keys.map(() => between(next, 0.5, 1.5));
  const sum = weights.reduce((s, w) => s + w, 0);

  const out: Record<string, number> = {};
  let assigned = 0;
  keys.forEach((key, i) => {
    const value =
      i === keys.length - 1
        ? round(total - assigned, 4)
        : round((total * weights[i]) / sum, 4);
    out[key] = value;
    assigned = round(assigned + value, 4);
  });
  return out;
}

export type TemplateSpec = {
  craftingFormula: "CPM_OVER_EFFICIENCY" | "HOURLY_OVER_60";
  materialFormula: "ADDITIVE_PER_METER" | "COST_PER_UOM";
  trimKeys: string[];
  packagingKeys: string[];
};

/**
 * The whole reconstruction. Returns the line items AND the buckets they
 * actually compute to, so the caller stores figures that agree with the form.
 */
export function buildLineItems(
  buckets: Buckets,
  spec: TemplateSpec,
  next: ReturnType<typeof rng>,
) {
  const base =
    spec.materialFormula === "ADDITIVE_PER_METER"
      ? percaleLines(buckets, next)
      : ponteLines(buckets, next);

  const values: Record<string, number | string> = {
    ...base,
    ...spread(buckets.TRIM_HARDWARE, spec.trimKeys, next),
    ...spread(buckets.PACKAGING, spec.packagingKeys, next),
  };

  // Recompute through the SAME function the form uses, so what is stored is
  // exactly what the vendor would see — no drift between seed and screen.
  const computed = computeQuote(values, spec);

  return { values, buckets: computed.buckets, fob: computed.fob };
}
