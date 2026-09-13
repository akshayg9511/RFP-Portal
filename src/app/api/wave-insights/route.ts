import { db } from "@/lib/db";
import { handle, numOr } from "@/lib/api";
import {
  cooBreakdown,
  coverage,
  unclassifiedDollars,
  vendorSpend,
  type AwardRow,
  type CooRules,
  type SpendCaps,
} from "@/domain/guardrails";

/**
 * @openapi
 * /api/wave-insights:
 *   get:
 *     summary: The wave rollup — coverage, guardrails, COO, vendors, savings
 *     description: >
 *       Coverage leads, and is required rather than decorative: China at 29%
 *       means something completely different at 40% coverage than at 95%.
 *     responses:
 *       200: { description: The rollup }
 */
export function GET() {
  return handle(async () => {
    const [awards, styles, cooConfig, capConfig] = await Promise.all([
      db.award.findMany({
        include: {
          vendor: {
            select: {
              id: true,
              name: true,
              cooRegion: true,
              isNewToQuince: true,
            },
          },
          style: { select: { id: true, baselineFob: true, planUnits: true } },
        },
      }),
      db.style.findMany({
        select: { id: true, planUnits: true, baselineFob: true },
      }),
      db.config.findUnique({ where: { key: "guardrails.coo" } }),
      db.config.findUnique({ where: { key: "guardrails.vendorSpendCap" } }),
    ]);

    const rules = (cooConfig?.value ?? {}) as CooRules;
    const caps = (capConfig?.value ?? {
      incumbentOrExisting: 20_000_000,
      new: 10_000_000,
    }) as SpendCaps;

    const rows: AwardRow[] = awards.map((a) => ({
      styleId: a.styleId,
      vendorId: a.vendor.id,
      vendorName: a.vendor.name,
      cooRegion: a.vendor.cooRegion,
      isNewToQuince: a.vendor.isNewToQuince,
      awardedDollars: numOr(a.awardedDollars),
    }));

    const dollarsPlaced = rows.reduce((s, r) => s + r.awardedDollars, 0);
    const dollarsPotential = styles.reduce(
      (s, st) => s + (st.planUnits ?? 0) * numOr(st.baselineFob),
      0,
    );

    const savings = awards.reduce((s, a) => s + numOr(a.savingsDollars), 0);
    const baselineOfAllocated = awards.reduce(
      (s, a) =>
        s +
        numOr(a.awardedUnits) * numOr(a.style.baselineFob),
      0,
    );

    // Vendor type split, by SKU count and award dollars.
    const typeSplit = { INCUMBENT: 0, EXISTING: 0, NEW: 0 } as Record<
      string,
      number
    >;
    for (const a of awards) {
      const key = a.vendor.isNewToQuince ? "NEW" : "EXISTING";
      typeSplit[key] += numOr(a.awardedDollars);
    }

    return {
      coverage: coverage(
        styles.length,
        new Set(rows.map((r) => r.styleId)),
        dollarsPlaced,
        dollarsPotential,
      ),

      // Caps breach and are actionable. Floors are wave targets and appear
      // ONLY here — never in the per-style rail, because the allocator cannot
      // fix them from a single style.
      guardrails: {
        coo: cooBreakdown(rows, rules),
        vendors: vendorSpend(rows, caps),
        unclassifiedDollars: unclassifiedDollars(rows),
      },

      vendorTypeSplit: typeSplit,

      savings: {
        dollars: savings,
        percentVsBaseline: baselineOfAllocated
          ? savings / baselineOfAllocated
          : 0,
      },

      // Named explicitly by Tony as something he needs, and absent from the
      // current workbook.
      stylesTakingIncrease: awards
        .filter((a) => numOr(a.savingsDollars) < 0)
        .map((a) => ({
          styleId: a.styleId,
          vendorName: a.vendor.name,
          increaseDollars: -numOr(a.savingsDollars),
        })),
    };
  });
}
