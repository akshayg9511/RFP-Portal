import { db } from "@/lib/db";
import { handle, num } from "@/lib/api";

/**
 * @openapi
 * /api/vendors/{vendorId}/styles:
 *   get:
 *     summary: The products a vendor currently supplies, with their current FOB
 *     description: >
 *       The CurrentSupplier relation, which is also what makes "Incumbent"
 *       derivable rather than stored (Build Doc 3.7). Internal only — this is
 *       procurement's view and never reaches a vendor screen.
 *     responses:
 *       200: { description: Styles this vendor supplies today }
 */
export function GET(
  _request: Request,
  { params }: { params: Promise<{ vendorId: string }> },
) {
  return handle(async () => {
    const { vendorId } = await params;

    const links = await db.currentSupplier.findMany({
      // One row per style, not one per variation.
      where: { vendorId, variationId: null },
      include: {
        style: {
          select: {
            id: true,
            styleNumber: true,
            name: true,
            images: {
              where: { isHero: true },
              orderBy: { position: "asc" },
              take: 1,
              select: { url: true },
            },
          },
        },
      },
      orderBy: { style: { styleNumber: "asc" } },
    });

    return links.map((l) => ({
      id: l.style.id,
      styleNumber: l.style.styleNumber,
      name: l.style.name,
      heroImage: l.style.images[0]?.url ?? null,
      currentFob: num(l.currentFob),
    }));
  });
}
