/**
 * Quote arithmetic — the line-item formulas from the real vendor templates.
 *
 * A line item is an INPUT GROUP WITH A FORMULA, not a single number: the
 * system owns the arithmetic so the vendor cannot get it wrong and procurement
 * can compare like with like (Build Doc §3.4).
 *
 * The two templates genuinely differ, verified in the cells of the real files:
 *
 *   Percale  crafting = rate / efficiency * SAM       (=E52/E53*E54)
 *   Ponte    crafting = hourly / 60 * SUM(SAM)        (=E50/60*E54)
 *
 *   Percale  material = consumption * (grey + dye + print) * (1 + wastage)
 *   Ponte    material = consumption * cost/UoM * (1 + wastage1 + wastage2)
 *
 * They roll up to the SAME FOB, which is why all comparison runs on bucket
 * totals and never on line items.
 *
 * Pure functions, no framework imports — this runs in the browser as the
 * vendor types, and on the server when the quote is saved.
 */

export type QuoteValues = Record<string, number | string | null | undefined>;

export type CraftingFormula = "CPM_OVER_EFFICIENCY" | "HOURLY_OVER_60";
export type MaterialFormula = "ADDITIVE_PER_METER" | "COST_PER_UOM";

function n(values: QuoteValues, key: string): number {
  const v = values[key];
  // Floored at zero: a cost, quantity or rate is never negative, and `min` on
  // the input is a browser hint rather than a guarantee — a pasted or
  // scripted value would otherwise reduce the FOB.
  if (typeof v === "number") return Number.isFinite(v) ? Math.max(0, v) : 0;
  if (typeof v === "string" && v.trim() !== "") {
    const parsed = Number(v);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  }
  return 0;
}

/** Percentages are entered as whole numbers (12 = 12%), as the real sheets do. */
function pct(values: QuoteValues, key: string): number {
  return n(values, key) / 100;
}

export function materialCost(
  values: QuoteValues,
  formula: MaterialFormula,
): { core: number; total: number } {
  let core: number;

  if (formula === "ADDITIVE_PER_METER") {
    // Lauren Home: a stack of per-meter costs, one wastage rate.
    const perMeter =
      n(values, "greyCostPerMeter") +
      n(values, "dyeingCostPerMeter") +
      n(values, "printingCostPerMeter");
    core = n(values, "consumption") * perMeter * (1 + pct(values, "wastage"));
  } else {
    // Ponte: one cost per UoM, two wastage rates — grading and production.
    core =
      n(values, "consumption") *
      n(values, "costPerUom") *
      (1 + pct(values, "wastageGrading") + pct(values, "wastageProduction"));
  }

  return { core, total: core + n(values, "otherMaterialsCost") };
}

export function craftingCost(
  values: QuoteValues,
  formula: CraftingFormula,
): { core: number; total: number; totalSam: number } {
  let core: number;
  let totalSam: number;

  if (formula === "CPM_OVER_EFFICIENCY") {
    // Lauren Home: a per-minute rate divided by line efficiency.
    totalSam = n(values, "sam");
    const efficiency = pct(values, "lineEfficiency");
    core = efficiency > 0 ? (n(values, "directLaborRate") / efficiency) * totalSam : 0;
  } else {
    // Ponte: an hourly wage over 60, against SAM split three ways.
    totalSam =
      n(values, "cuttingSam") + n(values, "sewingSam") + n(values, "finishingSam");
    core = (n(values, "hourlyWage") / 60) * totalSam;
  }

  const total =
    core +
    n(values, "washCost") +
    n(values, "embellishingCost") +
    n(values, "otherCraftingCost");

  return { core, total, totalSam };
}

export function trimCost(values: QuoteValues, lineKeys: string[]): number {
  return lineKeys.reduce((sum, key) => sum + n(values, key), 0);
}

export function packagingCost(values: QuoteValues, lineKeys: string[]): number {
  return lineKeys.reduce((sum, key) => sum + n(values, key), 0);
}

export type BucketTotals = {
  BASE_MATERIALS: number;
  TRIM_HARDWARE: number;
  PACKAGING: number;
  CRAFTING: number;
  OVERHEAD_SGA_PROFIT: number;
};

export type QuoteComputation = {
  buckets: BucketTotals;
  /** The identity both real templates share. */
  fob: number;
  /** Derived, and shown back to the vendor as a sanity check on their margin. */
  overheadPercent: number;
  totalSam: number;
  coreMaterialCost: number;
  coreCraftingCost: number;
  /**
   * Buckets whose figure came from a TYPED total rather than its line items
   * (J1). The form uses this to mark those numbers as the vendor's own
   * estimate, so a typed total is never presented as if it were derived.
   */
  overriddenBuckets: (keyof BucketTotals)[];
};

/**
 * The input key a vendor types a bucket total into (J1).
 *
 * `totalMaterialCost` and `totalCraftingCost` already exist in both real
 * templates as DERIVED lines, so the light template reuses those keys
 * rather than inventing parallel ones — the same field, filled by hand when
 * the detail behind it does not exist yet.
 */
const BUCKET_INPUT: Record<keyof BucketTotals, string> = {
  BASE_MATERIALS: "totalMaterialCost",
  TRIM_HARDWARE: "totalTrimCost",
  PACKAGING: "totalPackagingCost",
  CRAFTING: "totalCraftingCost",
  OVERHEAD_SGA_PROFIT: "overheadCost",
};

/**
 * Everything the form recomputes on each keystroke.
 *
 * `sumKeys` come from the template definition, so a template that adds a trim
 * line needs no code change — only the bucket FORMULAS are per-category.
 */
export function computeQuote(
  values: QuoteValues,
  spec: {
    craftingFormula: CraftingFormula;
    materialFormula: MaterialFormula;
    trimKeys: string[];
    packagingKeys: string[];
  },
): QuoteComputation {
  const material = materialCost(values, spec.materialFormula);
  const crafting = craftingCost(values, spec.craftingFormula);
  const trim = trimCost(values, spec.trimKeys);
  const packaging = packagingCost(values, spec.packagingKeys);
  const overhead = n(values, "overheadCost");

  const derived: BucketTotals = {
    BASE_MATERIALS: material.total,
    TRIM_HARDWARE: trim,
    PACKAGING: packaging,
    CRAFTING: crafting.total,
    OVERHEAD_SGA_PROFIT: overhead,
  };

  /**
   * A TYPED BUCKET TOTAL OVERRIDES THE DERIVED ONE — decision J1, 4 Oct.
   *
   * The initial (light) quote asks for five bucket totals and nothing else.
   * Until now this function ALWAYS derived Materials and Crafting from their
   * line items, and `totalMaterialCost` is itself a derived line in the
   * template — so a light template with its line items folded away had no
   * editable field for the two largest buckets. Akshay found it: "during the
   * initial quote, how is he entering just the total cost, not the
   * individual cost?" It was not awkward, it was unusable.
   *
   * PRECEDENCE: the line items win once they produce a value, because they
   * are the more specific statement and the full template is what the later
   * stages ask for. A typed total is the vendor's estimate BEFORE that
   * detail exists. `overriddenBuckets` reports which buckets fell back to a
   * typed figure, so the form can say which numbers are estimates rather
   * than silently presenting them as derived.
   *
   * One function, one documented rule. A second code path for "light" would
   * be the `if (grain === "STYLE")` mistake in a new place.
   */
  const buckets: BucketTotals = { ...derived };
  const overriddenBuckets: (keyof BucketTotals)[] = [];

  for (const key of Object.keys(derived) as (keyof BucketTotals)[]) {
    const typed = values[BUCKET_INPUT[key]];
    const typedNumber =
      typeof typed === "number"
        ? typed
        : typeof typed === "string" && typed.trim() !== ""
          ? Number(typed)
          : NaN;
    if (!Number.isFinite(typedNumber)) continue;

    // Only fall back to the typed figure where the line items produced
    // nothing. OVERHEAD_SGA_PROFIT is already a single input, so it can
    // never be overridden — its "derived" value IS the typed one.
    if (derived[key] === 0 && typedNumber !== 0) {
      buckets[key] = typedNumber;
      overriddenBuckets.push(key);
    }
  }

  // The identity shared by both templates:
  //   SUM(crafting, packaging, trim, material, overhead)
  const fob =
    buckets.BASE_MATERIALS +
    buckets.TRIM_HARDWARE +
    buckets.PACKAGING +
    buckets.CRAFTING +
    buckets.OVERHEAD_SGA_PROFIT;

  // The real sheets derive this to back-check the margin.
  const beforeOverhead = fob - overhead;

  return {
    buckets,
    fob,
    overheadPercent: beforeOverhead > 0 ? overhead / beforeOverhead : 0,
    totalSam: crafting.totalSam,
    coreMaterialCost: material.core,
    coreCraftingCost: crafting.core,
    /** Buckets taking a typed total because their line items are empty. */
    overriddenBuckets,
  };
}

/**
 * Which inputs a formula needs before its derived value means anything.
 *
 * The Lauren Home sheet wraps every derived cell in IF(..., "MISSING INPUT"),
 * which is the better model for a form: it names the missing input rather than
 * quietly showing zero.
 */
export function missingInputs(
  values: QuoteValues,
  spec: {
    craftingFormula: CraftingFormula;
    materialFormula: MaterialFormula;
    /**
     * "LIGHT" asks for the five bucket TOTALS; "FULL" asks for the line
     * items behind them. Defaults to FULL so every existing caller keeps
     * its current behaviour.
     */
    template?: "LIGHT" | "FULL";
  },
): string[] {
  const missing: string[] = [];
  const has = (key: string) => n(values, key) > 0;

  /**
   * THE LIGHT TEMPLATE IS SATISFIED BY ITS TOTALS.
   *
   * This function asks for consumption, grey cost, labour rate, line
   * efficiency and SAM — the LINE ITEMS. On the light template those fields
   * are not collected, so a vendor who had correctly entered all five bucket
   * totals and watched FOB compute still found Submit disabled, with nothing
   * on screen explaining why. Akshay: "why 5 inputs are still needed. why
   * can't I submit quote?"
   *
   * J1 made the totals ENTERABLE but left this gate asking for the detail,
   * so the light template could be filled and never submitted — the feature
   * was half-built, which is worse than absent.
   *
   * At LIGHT the question is therefore "do I have a total for every bucket",
   * and the answer is the buckets themselves. The line items stay optional,
   * exactly as the form presents them.
   */
  if (spec.template === "LIGHT") {
    const buckets: [string, string][] = [
      ["totalMaterialCost", "materials"],
      ["totalTrimCost", "trim"],
      ["totalPackagingCost", "packaging"],
      ["totalCraftingCost", "crafting"],
      ["overheadCost", "overhead"],
    ];
    for (const [key, label] of buckets) {
      // A bucket driven by its line items is satisfied too — a vendor who
      // filled the detail early must not be asked for the total as well.
      if (!has(key) && !bucketHasDetail(values, key, spec)) missing.push(label);
    }
    return missing;
  }

  if (spec.materialFormula === "ADDITIVE_PER_METER") {
    if (!has("consumption")) missing.push("consumption");
    if (!has("greyCostPerMeter")) missing.push("greyCostPerMeter");
  } else {
    if (!has("consumption")) missing.push("consumption");
    if (!has("costPerUom")) missing.push("costPerUom");
  }

  if (spec.craftingFormula === "CPM_OVER_EFFICIENCY") {
    if (!has("directLaborRate")) missing.push("directLaborRate");
    if (!has("lineEfficiency")) missing.push("lineEfficiency");
    if (!has("sam")) missing.push("sam");
  } else {
    if (!has("hourlyWage")) missing.push("hourlyWage");
    if (!has("cuttingSam") && !has("sewingSam") && !has("finishingSam")) {
      missing.push("sewingSam");
    }
  }

  if (!has("overheadCost")) missing.push("overheadCost");

  return missing;
}

/**
 * Does this bucket already have a value from its LINE ITEMS?
 *
 * Only Materials and Crafting are computed; the other three are plain sums
 * of their own money lines, which `computeQuote` reads directly — so for
 * those the typed total IS the only source and there is nothing to check.
 */
function bucketHasDetail(
  values: QuoteValues,
  key: string,
  spec: { craftingFormula: CraftingFormula; materialFormula: MaterialFormula },
): boolean {
  if (key === "totalMaterialCost") {
    return materialCost(values, spec.materialFormula).total > 0;
  }
  if (key === "totalCraftingCost") {
    return craftingCost(values, spec.craftingFormula).total > 0;
  }
  return false;
}
