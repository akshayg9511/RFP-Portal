import { db } from "@/lib/db";
import { handle, num } from "@/lib/api";

/**
 * @openapi
 * /api/vendors:
 *   get:
 *     summary: Vendor master — nomination, and the Vendor View picker
 *     parameters:
 *       - name: q
 *         in: query
 *         schema: { type: string }
 *       - name: styleId
 *         in: query
 *         description: Returns only vendors currently supplying this style
 *         schema: { type: string }
 *     responses:
 *       200: { description: Vendors, with derived type where a style is given }
 */
export function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q");
  const styleId = url.searchParams.get("styleId");

  return handle(async () => {
    const vendors = await db.vendor.findMany({
      where: {
        ...(q ? { OR: [{ name: { contains: q } }, { vendorCode: { contains: q } }] } : {}),
        ...(styleId ? { currentSupplierOf: { some: { styleId } } } : {}),
      },
      include: {
        currentSupplierOf: styleId
          ? { where: { styleId }, select: { currentFob: true } }
          : { select: { styleId: true } },
        _count: { select: { quotes: true, awards: true } },
        // Award dollars in this wave — the vendor master's whole reason to
        // exist is answering "who are we placing business with", and a count
        // of award ROWS does not answer that.
        awards: { select: { awardedDollars: true, savingsDollars: true } },
      },
      orderBy: { name: "asc" },
    });

    return vendors.map((v) => ({
      id: v.id,
      vendorCode: v.vendorCode,
      name: v.name,
      countryIso: v.countryIso,
      cooRegion: v.cooRegion,
      isNewToQuince: v.isNewToQuince,
      isTemp: v.isTemp,
      // Vendor type is DERIVED: the three labels fall out of one boolean plus
      // the current-supplier relation. Nobody types a type, so the Wave 1
      // multi-type data errors cannot occur.
      type: v.isNewToQuince
        ? "NEW"
        : v.currentSupplierOf.length > 0
          ? "INCUMBENT"
          : "EXISTING",
      currentFob:
        styleId && "currentFob" in (v.currentSupplierOf[0] ?? {})
          ? num((v.currentSupplierOf[0] as { currentFob: unknown }).currentFob as never)
          : null,
      stylesSupplied: v.currentSupplierOf.length,
      quoteCount: v._count.quotes,
      awardCount: v._count.awards,
      awardedDollars: v.awards.reduce((s, a) => s + (num(a.awardedDollars) ?? 0), 0),
      savingsDollars: v.awards.reduce((s, a) => s + (num(a.savingsDollars) ?? 0), 0),
    }));
  });
}
