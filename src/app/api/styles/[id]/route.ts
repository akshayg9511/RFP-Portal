import { db } from "@/lib/db";
import { notFound, num, numOr, ok, vendorType } from "@/lib/api";
import { fobFromBuckets } from "@/domain/cost";

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
    const cleanSheetBuckets: Record<string, number> = {};
    const baselineBuckets: Record<string, number> = {};
    for (const row of style.cleanSheets) {
      const into = row.kind === "BASELINE" ? baselineBuckets : cleanSheetBuckets;
      into[row.bucket] = (into[row.bucket] ?? 0) + numOr(row.amount);
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
      currentSuppliers: style.currentSuppliers.map((cs) => ({
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
