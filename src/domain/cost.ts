/**
 * The cost chain: FOB -> tariff -> logistics -> landed -> blend -> Best Cost.
 *
 * Pure functions, no framework imports — this ports to Kotlin near line for
 * line at V1, and runs in the browser for the Playground's live readout.
 *
 * Verified against Build Doc 11.4, Wave 1 row M--5 / JUNG KWANG INC.
 */

export type Blend = { air: number; ocean: number };

/** The wave constant. 70% air, 30% ocean (Build Doc 11.4). */
export const DEFAULT_BLEND: Blend = { air: 0.7, ocean: 0.3 };

export type CostInputs = {
  fob: number;
  /** Tariff as a fraction, e.g. 0.174 for 17.4%. */
  tariffRate: number;
  logisticsOcean: number;
  logisticsAir: number;
  /** Vendor-quoted DDP, where they quoted it. */
  ddpOcean?: number | null;
  ddpAir?: number | null;
  blend?: Blend;
  /**
   * Quince's freight decision for this bid (P3, 5 Oct). Absent = automatic,
   * the cheaper of the two blends. An override to DDP on a bid with no
   * (two-mode) DDP quote is IGNORED — Quince cannot choose a price the vendor
   * never gave, and silently costing it at zero would be the worst outcome.
   */
  basis?: Basis | null;
};

export type Basis = "QUINCE_BLEND" | "DDP_BLEND";

export type CostResult = {
  landedOcean: number;
  landedAir: number;
  quinceBlend: number;
  ddpBlend: number | null;
  bestCost: number;
  /**
   * Which side min() picked. Must be visible in the UI — two vendors' Best Cost
   * can differ in kind, and the selection is otherwise silent (Build Doc 11.7).
   */
  bestCostBasis: Basis;
  /** What automatic selection WOULD pick — shown beside an override. */
  automaticBasis: Basis;
  /** True only when Quince's override changed the answer's basis input. */
  overridden: boolean;
};

export function landedOcean(
  fob: number,
  tariffRate: number,
  logisticsOcean: number,
): number {
  return fob * (1 + tariffRate) + logisticsOcean;
}

export function landedAir(
  fob: number,
  tariffRate: number,
  logisticsAir: number,
): number {
  return fob * (1 + tariffRate) + logisticsAir;
}

export function blended(air: number, ocean: number, blend = DEFAULT_BLEND): number {
  return blend.air * air + blend.ocean * ocean;
}

export function computeCost(inputs: CostInputs): CostResult {
  const blend = inputs.blend ?? DEFAULT_BLEND;

  const lo = landedOcean(inputs.fob, inputs.tariffRate, inputs.logisticsOcean);
  const la = landedAir(inputs.fob, inputs.tariffRate, inputs.logisticsAir);
  const quinceBlend = blended(la, lo, blend);

  const hasDdp =
    inputs.ddpAir !== null &&
    inputs.ddpAir !== undefined &&
    inputs.ddpOcean !== null &&
    inputs.ddpOcean !== undefined;

  const ddpBlend = hasDdp
    ? blended(inputs.ddpAir as number, inputs.ddpOcean as number, blend)
    : null;

  const automaticBasis: Basis =
    ddpBlend !== null && ddpBlend < quinceBlend ? "DDP_BLEND" : "QUINCE_BLEND";

  // An override applies only where both bases exist. DDP chosen on a bid with
  // no DDP quote falls back to automatic rather than to a price of zero.
  const overrideUsable =
    inputs.basis === "QUINCE_BLEND" ||
    (inputs.basis === "DDP_BLEND" && ddpBlend !== null);
  const basis: Basis = overrideUsable ? inputs.basis! : automaticBasis;

  return {
    landedOcean: lo,
    landedAir: la,
    quinceBlend,
    ddpBlend,
    bestCost: basis === "DDP_BLEND" ? (ddpBlend as number) : quinceBlend,
    bestCostBasis: basis,
    automaticBasis,
    overridden: overrideUsable,
  };
}

/**
 * Bucket totals -> FOB. Identical across both real templates, which is why all
 * comparison runs here rather than on line items (Build Doc 2.2).
 */
export function fobFromBuckets(buckets: Record<string, number>): number {
  return (
    (buckets.BASE_MATERIALS ?? 0) +
    (buckets.TRIM_HARDWARE ?? 0) +
    (buckets.PACKAGING ?? 0) +
    (buckets.CRAFTING ?? 0) +
    (buckets.OVERHEAD_SGA_PROFIT ?? 0)
  );
}
