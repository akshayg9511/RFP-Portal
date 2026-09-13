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
};

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
  bestCostBasis: "QUINCE_BLEND" | "DDP_BLEND";
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

  const useDdp = ddpBlend !== null && ddpBlend < quinceBlend;

  return {
    landedOcean: lo,
    landedAir: la,
    quinceBlend,
    ddpBlend,
    bestCost: useDdp ? (ddpBlend as number) : quinceBlend,
    bestCostBasis: useDdp ? "DDP_BLEND" : "QUINCE_BLEND",
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
