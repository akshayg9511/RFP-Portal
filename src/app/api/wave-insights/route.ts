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
          style: {
            select: {
              id: true,
              styleNumber: true,
              name: true,
              baselineFob: true,
              baselineLanded: true,
              planUnits: true,
              // Who supplies this style TODAY — the only way to derive
              // INCUMBENT, which is a property of the style x vendor pair and
              // is never stored (Build Doc 3.7).
              currentSuppliers: { select: { vendorId: true } },
            },
          },
        },
      }),
      db.style.findMany({
        select: {
          id: true,
          planUnits: true,
          baselineFob: true,
          baselineLanded: true,
          // Only styles with a submitted bid are "in play" — see the note on
          // the coverage note below.
          quotes: { where: { status: "SUBMITTED" }, select: { id: true }, take: 1 },
        },
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
    /**
     * Baseline value per in-play style — the denominator, and after this change
     * also the numerator. See the note on `coverage()` in domain/guardrails.
     */
    const inPlay = styles
      .filter((st) => st.quotes.length > 0)
      .map((st) => ({
        styleId: st.id,
        units: st.planUnits ?? 0,
        baselineValue:
          (st.planUnits ?? 0) *
          (numOr(st.baselineLanded) || numOr(st.baselineFob)),
      }));

    // The wider frame: everything in the catalogue, so the screen can say what
    // is not yet out to bid at all.
    const catalogueValue = styles.reduce(
      (sum, st) =>
        sum +
        (st.planUnits ?? 0) * (numOr(st.baselineLanded) || numOr(st.baselineFob)),
      0,
    );

    const cov = coverage({
      inPlay,
      decidedStyleIds: new Set(rows.map((r) => r.styleId)),
      committedSpend: dollarsPlaced,
    });

    // Vendor type split by award dollars. All THREE types, derived — the
    // previous version could only ever emit EXISTING and NEW, so the incumbent
    // share was silently folded into "existing" and the donut showed two
    // slices where the Build Doc defines three.
    const typeSplit = { INCUMBENT: 0, EXISTING: 0, NEW: 0 } as Record<
      string,
      number
    >;
    for (const a of awards) {
      const suppliesThisStyle = a.style.currentSuppliers.some(
        (c) => c.vendorId === a.vendorId,
      );
      const key = a.vendor.isNewToQuince
        ? "NEW"
        : suppliesThisStyle
          ? "INCUMBENT"
          : "EXISTING";
      typeSplit[key] += numOr(a.awardedDollars);
    }

    return {
      coverage: {
        ...cov,
        stylesInCatalogue: styles.length,
        catalogueValue,
        // What has not been sent out at all — the rest of the catalogue.
        notInPlayStyles: styles.length - inPlay.length,
        notInPlayValue: catalogueValue - inPlay.reduce((s2, r) => s2 + r.baselineValue, 0),
      },

      // BOTH ends of every range appear here. Over-max also appears on the
      // per-style rail because it is actionable from one style; under-min does
      // not, because it usually needs a bidder-pool change rather than an
      // allocation (Build Doc 11.8).
      guardrails: {
        coo: cooBreakdown(rows, rules),
        vendors: vendorSpend(rows, caps),
        unclassifiedDollars: unclassifiedDollars(rows),
      },

      vendorTypeSplit: typeSplit,

      /**
       * Kept as its own block for the client, but sourced from `coverage()` so
       * there is ONE savings figure. It previously summed the stored
       * `savingsDollars` against a separately-derived baseline — the two agreed
       * today, and two ways to compute one number is how they stop agreeing.
       */
      savings: {
        dollars: cov.savings,
        percentVsBaseline: cov.savingsPercent,
      },

      // Named explicitly by Tony as something he needs, and absent from the
      // current workbook.
      // Grouped BY STYLE, not by award row. A style split across three vendors
      // produced three rows with the same style number, which reads as a
      // duplication bug rather than as a split — and the question here is
      // "which products are costing more", not "which award lines".
      stylesTakingIncrease: Object.values(
        awards
          .filter((a) => numOr(a.savingsDollars) < 0)
          .reduce<
            Record<
              string,
              {
                styleId: string;
                styleNumber: string;
                styleName: string;
                vendorNames: string[];
                increaseDollars: number;
              }
            >
          >((acc, a) => {
            const e = (acc[a.styleId] ??= {
              styleId: a.styleId,
              styleNumber: a.style.styleNumber,
              styleName: a.style.name,
              vendorNames: [],
              increaseDollars: 0,
            });
            e.increaseDollars += -numOr(a.savingsDollars);
            if (!e.vendorNames.includes(a.vendor.name)) {
              e.vendorNames.push(a.vendor.name);
            }
            return acc;
          }, {}),
      ).sort((x, y) => y.increaseDollars - x.increaseDollars),
    };
  });
}
