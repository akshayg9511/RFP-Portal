import { db } from "@/lib/db";
import { badRequest, handle, num } from "@/lib/api";

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

/**
 * @openapi
 * /api/style-sets:
 *   post:
 *     summary: Create a style set from a selection
 *     description: >
 *       Style sets are "manual, reusable" groupings (Build Doc 3.1) — which was
 *       not true while this API was GET-only. A set is created from whatever is
 *       in the selection tray, so the grouping you already made becomes the one
 *       you save.
 *     responses:
 *       200: { description: The created set }
 *       400: { description: No name, or no styles }
 */
export function POST(request: Request) {
  return handle(async () => {
    const body = (await request.json()) as {
      name?: string;
      description?: string | null;
      styleIds?: string[];
    };

    const name = body.name?.trim();
    if (!name) return badRequest("A style set needs a name");

    const styleIds = [...new Set(body.styleIds ?? [])];
    if (!styleIds.length) return badRequest("A style set needs at least one product");

    // A name collision is the user's to resolve — two sets called "Bedding
    // priority" is how you lose track of which one an RFP came from.
    const clash = await db.styleSet.findFirst({ where: { name } });
    if (clash) return badRequest(`A style set called "${name}" already exists`);

    const set = await db.styleSet.create({
      data: {
        name,
        description: body.description?.trim() || null,
        members: { create: styleIds.map((styleId) => ({ styleId })) },
      },
      include: { _count: { select: { members: true } } },
    });

    return {
      id: set.id,
      name: set.name,
      description: set.description,
      styleCount: set._count.members,
    };
  });
}
