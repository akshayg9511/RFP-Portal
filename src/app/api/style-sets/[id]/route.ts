import { db } from "@/lib/db";
import { notFound, num, ok } from "@/lib/api";

/**
 * @openapi
 * /api/style-sets/{id}:
 *   get:
 *     summary: One style set with its member styles
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: The style set }
 *       404: { description: No such style set }
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const set = await db.styleSet.findUnique({
      where: { id },
      include: {
        members: {
          include: {
            style: {
              include: {
                images: {
                  where: { isHero: true },
                  orderBy: { position: "asc" },
                  take: 1,
                  select: { url: true },
                },
                _count: { select: { colourways: true, variations: true } },
              },
            },
          },
        },
      },
    });

    if (!set) return notFound(`Style set ${id}`);

    const styles = set.members.map((m) => ({
      id: m.style.id,
      styleNumber: m.style.styleNumber,
      name: m.style.name,
      subDepartment: m.style.subDepartment,
      material: m.style.material,
      variationLevel: m.style.variationLevel,
      heroImage: m.style.images[0]?.url ?? null,
      planUnits: m.style.planUnits,
      baselineFob: num(m.style.baselineFob),
      annualSpend: (m.style.planUnits ?? 0) * (num(m.style.baselineFob) ?? 0),
      colourwayCount: m.style._count.colourways,
      skuCount: m.style._count.variations,
    }));

    return ok({
      id: set.id,
      name: set.name,
      description: set.description,
      lastUsedIn: set.lastUsedIn,
      styleCount: styles.length,
      annualSpend: styles.reduce((s, x) => s + x.annualSpend, 0),
      styles: styles.sort((a, b) => b.annualSpend - a.annualSpend),
    });
  } catch (error) {
    console.error("[api/style-sets/[id]]", error);
    return Response.json(
      { error: "server_error", message: String(error) },
      { status: 500 },
    );
  }
}
