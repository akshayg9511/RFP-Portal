import { grainGroups, variationKeyOf, type Grain } from "@/domain/grain";
import { weightedBaseline } from "@/domain/award";
import { num } from "@/lib/api";

/**
 * A product's award groups, at its own grain — ONE implementation.
 *
 * Both the comparison (`api/styles/[id]/bids`) and the save
 * (`api/styles/[id]/award`) need exactly the same answer to "what are this
 * product's groups, and what volume and baseline does each carry". Computed
 * in two places they would drift, and a group's units disagreeing between
 * the readout and the save is how the live savings figure stops matching what
 * gets stored.
 *
 * A STYLE-grained product is ONE group, variationId null — the degenerate
 * case of the same path (§traps #2).
 */

export type AwardGroup = {
  variationId: string | null;
  variationKey: string;
  label: string;
  /** For per-size logistics in resolveBestCost. */
  size: string | null;
  planUnits: number;
  /** Volume-weighted across the group's variations, never a plain mean. */
  baselineFob: number;
  /**
   * The style's landed baseline scaled by this group's FOB ratio — landed
   * against landed, as allocate() requires (§award, the -$8.29M error).
   */
  baselineLanded: number;
  /**
   * The air / ocean split for this variant (P5). Every vendor on the group
   * is resolved with it, so the comparison stays like-for-like.
   */
  blend: { air: number; ocean: number };
  /** True when Quince set the split; false = the wave default. */
  splitSet: boolean;
};

type VariationIn = {
  id: string;
  size: string | null;
  colour: string | null;
  colourwayId: string | null;
  sizeSortOrder: number | null;
  planUnits: number | null;
  baselineFob: unknown;
};

export function awardGroups(
  style: {
    variationLevel: string | null;
    planUnits: number | null;
    baselineFob: unknown;
    baselineLanded: unknown;
    variations: VariationIn[];
    /** Per-variant splits, where Quince has set one. */
    freightSplits?: { variationKey: string; airPct: unknown }[];
  },
  /** The wave default, from the rate book. */
  defaultBlend: { air: number; ocean: number } = { air: 0.7, ocean: 0.3 },
): AwardGroup[] {
  const splits = new Map(
    (style.freightSplits ?? []).map((f) => [f.variationKey, Number(f.airPct)]),
  );
  const rows = style.variations.map((v) => ({
    ...v,
    planUnits: v.planUnits ?? 0,
    baselineFob: num(v.baselineFob as never) ?? 0,
  }));

  const styleBase = weightedBaseline(
    rows.map((v) => ({ baseline: v.baselineFob, planUnits: v.planUnits })),
  );
  const styleLanded =
    num(style.baselineLanded as never) ?? num(style.baselineFob as never) ?? 0;

  return grainGroups((style.variationLevel ?? "STYLE") as Grain, rows).map(
    (g) => {
      const own = rows.filter((v) => g.variationIds.includes(v.id));
      const isWhole = g.key === "@STYLE";
      const variationId = isWhole ? null : g.variationIds[0]!;
      const baselineFob = isWhole
        ? (num(style.baselineFob as never) ?? 0)
        : weightedBaseline(
            own.map((v) => ({ baseline: v.baselineFob, planUnits: v.planUnits })),
          );
      const scale =
        !isWhole && styleBase > 0 && baselineFob > 0 ? baselineFob / styleBase : 1;
      return {
        variationId,
        variationKey: variationKeyOf(variationId),
        label: isWhole ? "Whole product" : g.label,
        size: isWhole ? null : (own[0]?.size ?? null),
        // Whole product keeps the style's own plan, so a STYLE-grained style
        // is byte-identical to before variation awarding existed.
        planUnits: isWhole
          ? (style.planUnits ?? 0)
          : own.reduce((sum, v) => sum + v.planUnits, 0),
        baselineFob,
        baselineLanded: styleLanded * scale,
        ...(() => {
          const airPct = splits.get(variationKeyOf(variationId));
          return airPct === undefined || !Number.isFinite(airPct)
            ? { blend: defaultBlend, splitSet: false }
            : { blend: { air: airPct / 100, ocean: 1 - airPct / 100 }, splitSet: true };
        })(),
      };
    },
  );
}

/** Prisma select for what awardGroups needs from a style's variations. */
export const VARIATION_SELECT = {
  orderBy: [{ sizeSortOrder: "asc" as const }],
  select: {
    id: true,
    size: true,
    colour: true,
    colourwayId: true,
    sizeSortOrder: true,
    planUnits: true,
    baselineFob: true,
  },
};

/** Prisma select for a style's per-variant freight splits. */
export const FREIGHT_SPLIT_SELECT = {
  select: { variationKey: true, airPct: true },
};
