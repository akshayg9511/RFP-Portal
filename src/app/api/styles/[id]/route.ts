import { db } from "@/lib/db";
import { notFound, num, numOr, ok, vendorType } from "@/lib/api";
import { fobFromBuckets } from "@/domain/cost";
import { grainGroups, type Grain } from "@/domain/grain";
/**
 * @openapi
 * /api/styles/{id}:
 *   get:
 *     summary: Style detail — imagery, current suppliers, cost breakdown
 *     description: >
 *       Everything the style detail screen needs. The clean sheet is INTERNAL
 *       ONLY and must never be forwarded to a vendor surface.
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: The style }
 *       404: { description: No such style }
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    // Accept either the cuid or the human style number, so links can be
    // readable without a lookup.
    const style = await db.style.findFirst({
      where: { OR: [{ id }, { styleNumber: id }] },
      include: {
        colourways: {
          include: {
            images: { orderBy: { position: "asc" }, select: { url: true } },
          },
        },
        images: { orderBy: { position: "asc" }, select: { url: true, isHero: true } },
        variations: { orderBy: [{ sizeSortOrder: "asc" }, { size: "asc" }] },
        cleanSheets: true,
        currentSuppliers: { include: { vendor: true } },
      },
    });

    if (!style) return notFound(`Style ${id}`);

    // Two splits over the same buckets: what it costs today, and the target.
    // STYLE-LEVEL only — the per-variation rows are grouped separately below,
    // and summing both together would multiply every bucket by the variation
    // count.
    const cleanSheetBuckets: Record<string, number> = {};
    const baselineBuckets: Record<string, number> = {};
    for (const row of style.cleanSheets) {
      if (row.variationId !== null) continue;
      const into = row.kind === "BASELINE" ? baselineBuckets : cleanSheetBuckets;
      into[row.bucket] = (into[row.bucket] ?? 0) + numOr(row.amount);
    }

    // PER-VARIATION cost, so the drawer's dropdown changes real numbers.
    // Keyed by variation id; the client picks the one it is showing.
    type VariationCost = {
      baseline: Record<string, number>;
      cleanSheet: Record<string, number>;
      suppliers: Record<string, number | null>;
    };
    const costByVariation = new Map<string, VariationCost>();
    const costFor = (variationId: string): VariationCost => {
      const existing = costByVariation.get(variationId);
      if (existing) return existing;
      const fresh: VariationCost = { baseline: {}, cleanSheet: {}, suppliers: {} };
      costByVariation.set(variationId, fresh);
      return fresh;
    };
    for (const row of style.cleanSheets) {
      if (row.variationId === null) continue;
      const bucketSet = costFor(row.variationId);
      const into = row.kind === "BASELINE" ? bucketSet.baseline : bucketSet.cleanSheet;
      into[row.bucket] = (into[row.bucket] ?? 0) + numOr(row.amount);
    }
    for (const cs of style.currentSuppliers) {
      if (cs.variationId === null) continue;
      costFor(cs.variationId).suppliers[cs.vendorId] = num(cs.currentFob);
    }

    // Distinct sizes in display order, derived from the SKUs rather than from
    // Size Model — that column disagrees with reality on 36% of bedding styles.
    const sizes = [
      ...new Map(
        style.variations
          .filter((v) => v.size)
          .map((v) => [v.size, v.sizeSortOrder ?? 0]),
      ),
    ]
      .sort((a, b) => a[1] - b[1])
      .map(([size]) => size);

    return ok({
      id: style.id,
      styleNumber: style.styleNumber,
      name: style.name,
      division: style.division,
      department: style.department,
      subDepartment: style.subDepartment,
      subClass: style.subClass,
      material: style.material,
      variationLevel: style.variationLevel,
      websiteUrl: style.websiteUrl,

      planUnits: style.planUnits,
      baselineFob: num(style.baselineFob),
      retailPrice: num(style.retailPrice),

      htsCode: style.htsCode,
      weightG: num(style.weightG),

      sizes,

      /**
       * The product's bid groups at ITS grain, each with its own cost.
       *
       * This is what the drawer's dropdown switches between. Returned here
       * rather than fetched per variation: a product has 4-5 of these, so one
       * round trip beats five.
       */
      variationCost: grainGroups(
        style.variationLevel as Grain,
        style.variations.map((v) => ({
          id: v.id,
          size: v.size,
          sizeSortOrder: v.sizeSortOrder,
          colour: v.colour,
        })),
      ).map((group) => {
        const members = group.variationIds;
        // A group may roll several SKUs together at COLOUR or SIZE grain, so
        // its cost is the members' SUMMED buckets divided by their count —
        // the per-unit figure, which is what every other price on screen is.
        const baseline: Record<string, number> = {};
        const cleanSheet: Record<string, number> = {};
        const suppliers: Record<string, number | null> = {};
        for (const vid of members) {
          const cost = costByVariation.get(vid);
          if (!cost) continue;
          for (const [bucket, amount] of Object.entries(cost.baseline)) {
            baseline[bucket] = (baseline[bucket] ?? 0) + amount / members.length;
          }
          for (const [bucket, amount] of Object.entries(cost.cleanSheet)) {
            cleanSheet[bucket] =
              (cleanSheet[bucket] ?? 0) + amount / members.length;
          }
          for (const [vendorId, fob] of Object.entries(cost.suppliers)) {
            if (fob === null) continue;
            suppliers[vendorId] =
              (suppliers[vendorId] ?? 0) + fob / members.length;
          }
        }
        const first = style.variations.find((v) => v.id === members[0]);
        const planUnits = members.reduce((total, vid) => {
          const v = style.variations.find((x) => x.id === vid);
          return total + (v?.planUnits ?? 0);
        }, 0);
        return {
          id: members[0],
          label: group.label,
          variationIds: members,
          skuCount: members.length,
          planUnits,
          baselineFob: num(first?.baselineFob ?? null),
          baseline,
          cleanSheet,
          suppliers,
        };
      }),

      colourways: style.colourways.map((c) => ({
        id: c.id,
        name: c.name,
        websiteUrl: c.websiteUrl,
        images: c.images.map((i) => i.url),
      })),
      images: style.images.map((i) => i.url),
      heroImage: style.images.find((i) => i.isHero)?.url ?? null,

      // Who makes it TODAY — a style-level fact. Never call this "incumbent":
      // that is vendor type, a different concept (Build Doc 3.7).
      currentSuppliers: style.currentSuppliers
        .filter((cs) => cs.variationId === null)
        .map((cs) => ({
        vendorId: cs.vendor.id,
        vendorCode: cs.vendor.vendorCode,
        name: cs.vendor.name,
        countryIso: cs.vendor.countryIso,
        cooRegion: cs.vendor.cooRegion,
        currentFob: num(cs.currentFob),
        type: vendorType(cs.vendor.isNewToQuince, true),
      })),

      // What the style costs today, by bucket. Safe to show anywhere internal.
      baseline: {
        buckets: baselineBuckets,
        fob: fobFromBuckets(baselineBuckets),
      },

      // INTERNAL ONLY. Never forwarded to a vendor screen or export.
      cleanSheet: {
        buckets: cleanSheetBuckets,
        fob: fobFromBuckets(cleanSheetBuckets),
      },

      readiness: {
        hasBaseline: num(style.baselineFob) !== null,
        hasCleanSheet: style.cleanSheets.some((c) => c.kind === "CLEAN_SHEET"),
        hasImages: style.images.length > 0,
      },
    });
  } catch (error) {
    console.error("[api/styles/[id]]", error);
    return Response.json(
      { error: "server_error", message: String(error) },
      { status: 500 },
    );
  }
}
