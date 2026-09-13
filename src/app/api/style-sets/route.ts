import { db } from "@/lib/db";
import { handle, num } from "@/lib/api";

/**
 * @openapi
 * /api/style-sets:
 *   get:
 *     summary: Style sets with a cover image carousel
 *     description: >
 *       Style sets are the reusable grouping procurement selects from. Each
 *       carries 5-8 member images so the browser reads as a product rather
 *       than a list of names.
 *     responses:
 *       200:
 *         description: Style sets, largest first
 */
export function GET() {
  return handle(async () => {
    const sets = await db.styleSet.findMany({
      include: {
        members: {
          include: {
            style: {
              select: {
                id: true,
                styleNumber: true,
                name: true,
                planUnits: true,
                baselineFob: true,
                images: {
                  where: { isHero: true },
                  orderBy: { position: "asc" },
                  take: 1,
                  select: { url: true },
                },
              },
            },
          },
        },
      },
    });

    const rows = sets.map((set) => {
      const styles = set.members.map((m) => m.style);

      // Annual spend at baseline — what makes the list sortable by where the
      // money is.
      const annualSpend = styles.reduce(
        (total, s) => total + (s.planUnits ?? 0) * (num(s.baselineFob) ?? 0),
        0,
      );

      return {
        id: set.id,
        name: set.name,
        description: set.description,
        lastUsedIn: set.lastUsedIn,
        styleCount: styles.length,
        annualSpend,
        // The carousel. 8 is the documented ceiling for a Carousel — past it
        // nobody counts the dots.
        coverImages: styles
          .map((s) => s.images[0]?.url)
          .filter((url): url is string => !!url)
          .slice(0, 8),
      };
    });

    return rows.sort((a, b) => b.annualSpend - a.annualSpend);
  });
}
