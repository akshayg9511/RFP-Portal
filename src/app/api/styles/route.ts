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
 *       - name: department
 *         in: query
 *         schema: { type: string }
 *       - name: subDepartment
 *         in: query
 *         schema: { type: string }
 *       - name: material
 *         in: query
 *         schema: { type: string }
 *       - name: minRevenue
 *         in: query
 *         description: Annual revenue at retail, planUnits x retailPrice
 *         schema: { type: number }
 *       - name: inSet
 *         in: query
 *         description: "any | none — whether the style belongs to a style set"
 *         schema: { type: string }
 *     responses:
 *       200: { description: Matching styles, with facet counts }
 */
export function GET(request: Request) {
  const url = new URL(request.url);
  const styleSetId = url.searchParams.get("styleSetId");
  const q = url.searchParams.get("q");
  const division = url.searchParams.get("division");
  const department = url.searchParams.get("department");
  const subDepartment = url.searchParams.get("subDepartment");
  const material = url.searchParams.get("material");
  const minRevenue = Number(url.searchParams.get("minRevenue")) || 0;
  const inSet = url.searchParams.get("inSet");

  return handle(async () => {
    const styles = await db.style.findMany({
      where: {
        ...(styleSetId ? { setMembers: { some: { styleSetId } } } : {}),
        ...(division ? { division } : {}),
        ...(department ? { department } : {}),
        ...(subDepartment ? { subDepartment } : {}),
        ...(material ? { material } : {}),
        // Products never grouped are the ones quietly missing from every RFP.
        ...(inSet === "any" ? { setMembers: { some: {} } } : {}),
        ...(inSet === "none" ? { setMembers: { none: {} } } : {}),
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
        _count: {
          select: { colourways: true, variations: true, quotes: true, setMembers: true },
        },
      },
      orderBy: { styleNumber: "asc" },
    });

    /**
     * Revenue is DERIVED: plan units x retail price.
     *
     * `Style.revenue2026` exists in the schema and is seeded on 0 of 82 styles,
     * while planUnits and retailPrice are populated on all 82 — so the figure
     * is available without inventing data. This is what the product SELLS;
     * `annualSpend` (units x baseline FOB) is what Quince PAYS, and the two
     * rank a catalogue differently.
     */
    const withRevenue = styles.map((s) => ({
      style: s,
      revenue: (s.planUnits ?? 0) * (num(s.retailPrice) ?? 0),
    }));

    const rows = withRevenue.filter((r) => r.revenue >= minRevenue);

    /**
     * Facet counts from the FILTERED set, so a filter that would return
     * nothing reads as zero rather than disappearing from the control.
     */
    const facet = (key: "division" | "department" | "subDepartment" | "material") => {
      const counts = new Map<string, number>();
      for (const r of rows) {
        const v = r.style[key];
        if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
      }
      return [...counts.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count);
    };

    return {
      facets: {
        division: facet("division"),
        department: facet("department"),
        subDepartment: facet("subDepartment"),
        material: facet("material"),
      },
      total: rows.length,
      styles: rows.map(({ style: s, revenue }) => ({
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
      retailPrice: num(s.retailPrice),
      // The catalogue's primary sort — see the note above.
      revenue,
      setCount: s._count.setMembers,
      currentSuppliers: s.currentSuppliers.map((cs) => ({
        name: cs.vendor.name,
        cooRegion: cs.vendor.cooRegion,
        currentFob: num(cs.currentFob),
      })),
      })),
    };
  });
}
