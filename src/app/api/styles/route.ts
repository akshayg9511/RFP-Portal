import { db } from "@/lib/db";
import { handle, num } from "@/lib/api";

/**
 * @openapi
 * /api/styles:
 *   get:
 *     summary: Styles, filterable — the browser and the selection tray
 *     parameters:
 *       - name: styleSetId
 *         in: query
 *         schema: { type: string }
 *       - name: q
 *         in: query
 *         description: Free text across style number and name
 *         schema: { type: string }
 *       - name: division
 *         in: query
 *         schema: { type: string }
 *     responses:
 *       200: { description: Matching styles }
 */
export function GET(request: Request) {
  const url = new URL(request.url);
  const styleSetId = url.searchParams.get("styleSetId");
  const q = url.searchParams.get("q");
  const division = url.searchParams.get("division");

  return handle(async () => {
    const styles = await db.style.findMany({
      where: {
        ...(styleSetId ? { setMembers: { some: { styleSetId } } } : {}),
        ...(division ? { division } : {}),
        ...(q
          ? {
              OR: [
                { styleNumber: { contains: q } },
                { name: { contains: q } },
              ],
            }
          : {}),
      },
      include: {
        images: {
          where: { isHero: true },
          orderBy: { position: "asc" },
          take: 1,
          select: { url: true },
        },
        currentSuppliers: {
          include: { vendor: { select: { name: true, cooRegion: true } } },
        },
        _count: { select: { colourways: true, variations: true, quotes: true } },
      },
      orderBy: { styleNumber: "asc" },
    });

    return styles.map((s) => ({
      id: s.id,
      styleNumber: s.styleNumber,
      name: s.name,
      division: s.division,
      department: s.department,
      subDepartment: s.subDepartment,
      material: s.material,
      variationLevel: s.variationLevel,
      heroImage: s.images[0]?.url ?? null,
      planUnits: s.planUnits,
      baselineFob: num(s.baselineFob),
      annualSpend: (s.planUnits ?? 0) * (num(s.baselineFob) ?? 0),
      colourwayCount: s._count.colourways,
      skuCount: s._count.variations,
      bidCount: s._count.quotes,
      currentSuppliers: s.currentSuppliers.map((cs) => ({
        name: cs.vendor.name,
        cooRegion: cs.vendor.cooRegion,
        currentFob: num(cs.currentFob),
      })),
    }));
  });
}
