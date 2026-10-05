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
export function GET(request: Request) {
  return handle(async () => {
    /**
     * THE HIERARCHY FILTERS — decision N8, 5 Oct.
     *
     * Tony and Jeremiah: percentages must be viewable at wave / division /
     * department / sub-department — "is China under 30% across all apparel".
     * No wave filter: the unfiltered page IS the wave. Every block below is
     * computed on the selected slice.
     */
    const url = new URL(request.url);
    const division = url.searchParams.get("division") || null;
    const department = url.searchParams.get("department") || null;
    const subDepartment = url.searchParams.get("subDepartment") || null;
    const filtered = Boolean(division || department || subDepartment);
    const styleWhere = {
      ...(division ? { division } : {}),
      ...(department ? { department } : {}),
      ...(subDepartment ? { subDepartment } : {}),
    };

    /**
     * WHAT COUNTS — N17. Only AWARDED and READY_FOR_REVIEW, per feature list
     * #40. This read every award row with no `where`, so a split someone was
     * still experimenting with (ALLOCATED) moved committed spend and China
     * share on every save.
     */
    const COUNTED = ["AWARDED", "READY_FOR_REVIEW"];

    const [allAwards, styles, cooConfig, capConfig, hierarchy] = await Promise.all([
      db.award.findMany({
        where: { status: { in: COUNTED } },
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
              division: true,
              department: true,
              subDepartment: true,
              // Who supplies this style TODAY — the only way to derive
              // INCUMBENT, which is a property of the style x vendor pair and
              // is never stored (Build Doc 3.7).
              currentSuppliers: { select: { vendorId: true } },
            },
          },
        },
      }),
      db.style.findMany({
        where: styleWhere,
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
      // Every style's place in the hierarchy, for the filter facets.
      db.style.findMany({
        select: { division: true, department: true, subDepartment: true },
      }),
    ]);

    // Awards in the selected slice. The whole wave is kept too (N16): a
    // vendor cap is a property of the VENDOR, not the slice.
    const inSlice = (st: {
      division: string | null;
      department: string | null;
      subDepartment: string | null;
    }) =>
      (!division || st.division === division) &&
      (!department || st.department === department) &&
      (!subDepartment || st.subDepartment === subDepartment);
    const awards = allAwards.filter((a) => inSlice(a.style));

    const rules = (cooConfig?.value ?? {}) as CooRules;
    const caps = (capConfig?.value ?? {
      incumbentOrExisting: 20_000_000,
      new: 10_000_000,
    }) as SpendCaps;

    /**
     * One row per award — which is PER VARIATION now. Each carries its own
     * dollars (its own share of the style's volume), so summing them counts
     * every dollar once; style counts below use a Set of styleIds, so a
     * 5-size product is still one style.
     */
    const toRow = (a: (typeof allAwards)[number]): AwardRow => ({
      styleId: a.styleId,
      vendorId: a.vendor.id,
      vendorName: a.vendor.name,
      cooRegion: a.vendor.cooRegion,
      isNewToQuince: a.vendor.isNewToQuince,
      awardedDollars: numOr(a.awardedDollars),
      // N14 — incumbent on THIS style, derived, never stored.
      isIncumbent: a.style.currentSuppliers.some((c) => c.vendorId === a.vendorId),
    });
    const rows: AwardRow[] = awards.map(toRow);
    const waveRows: AwardRow[] = allAwards.map(toRow);

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

    /**
     * VENDOR TYPE: EXISTING vs NEW only — decision N12, 5 Oct.
     *
     * Akshay: "incumbent doesn't make sense here. Incumbent and existing are
     * product-level attributes, not wave-level or RFP-level attributes." A
     * vendor is new to Quince or not; whether it is the incumbent depends on
     * the product, so incumbency lives in the per-vendor cap bars (N14).
     */
    const typeSplit = { EXISTING: 0, NEW: 0 } as Record<string, number>;
    for (const r of rows) {
      typeSplit[r.isNewToQuince ? "NEW" : "EXISTING"] += r.awardedDollars;
    }

    /**
     * VENDOR SPEND, in the slice AND across the wave — N16.
     *
     * The bar shows the slice; the cap is checked on the WAVE-WIDE total, so
     * filtering to a division where a vendor is under $20M can never hide that
     * they are over it across the wave.
     */
    const waveSpend = new Map(
      vendorSpend(waveRows, caps).map((v) => [v.vendorId, v]),
    );
    const vendors = vendorSpend(rows, caps).map((v) => {
      const wave = waveSpend.get(v.vendorId);
      return {
        ...v,
        waveDollars: wave?.dollars ?? v.dollars,
        waveBreached: wave?.breached ?? v.breached,
      };
    });

    /** Facets for the three filters, each narrowed by the levels above it. */
    const count = (values: (string | null)[]) => {
      const m = new Map<string, number>();
      for (const v of values) if (v) m.set(v, (m.get(v) ?? 0) + 1);
      return [...m.entries()]
        .map(([value, n]) => ({ value, count: n }))
        .sort((a, b) => a.value.localeCompare(b.value));
    };
    const facets = {
      division: count(hierarchy.map((h) => h.division)),
      department: count(
        hierarchy.filter((h) => !division || h.division === division).map((h) => h.department),
      ),
      subDepartment: count(
        hierarchy
          .filter(
            (h) =>
              (!division || h.division === division) &&
              (!department || h.department === department),
          )
          .map((h) => h.subDepartment),
      ),
    };

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
      /**
       * N9 — the SAME thresholds at every level, but below wave level a
       * breach is a FLAG: one department can be legitimately China-heavy
       * while the wave stays compliant. The client reads `filtered`.
       */
      scope: { filtered, division, department, subDepartment },
      facets,

      guardrails: {
        coo: cooBreakdown(rows, rules),
        vendors,
        unclassifiedDollars: unclassifiedDollars(rows),
        /** Totals for the cap bars' legend (N15). */
        incumbencyTotals: vendors.reduce(
          (t, v) => ({
            incumbent: t.incumbent + v.split.incumbent,
            existing: t.existing + v.split.existing,
            new: t.new + v.split.new,
          }),
          { incumbent: 0, existing: 0, new: 0 },
        ),
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
