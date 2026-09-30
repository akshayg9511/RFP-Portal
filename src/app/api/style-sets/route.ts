import { db } from "@/lib/db";
import { badRequest, handle, num } from "@/lib/api";
import { variationKeyOf, WHOLE_STYLE_KEY } from "@/domain/grain";
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
      // DISTINCT products, not member rows. Once a set can hold three sizes
      // of one product, `members.map(m => m.style)` counts that product three
      // times — the card would read "3 products" for one, and annual spend
      // would be tripled.
      const byStyle = new Map<string, (typeof set.members)[number]["style"]>();
      for (const member of set.members) {
        if (!byStyle.has(member.styleId)) byStyle.set(member.styleId, member.style);
      }
      const styles = [...byStyle.values()];

      // Annual spend at baseline — what makes the list sortable by where the
      // money is. Summed over DISTINCT products for the reason above.
      const annualSpend = styles.reduce(
        (total, s) => total + (s.planUnits ?? 0) * (num(s.baselineFob) ?? 0),
        0,
      );

      // Variation rows, so a card can say "5 products · 3 SKUs" when part of
      // the set is picked at variation level.
      const skuCount = set.members.filter((m) => m.variationId !== null).length;

      return {
        id: set.id,
        name: set.name,
        description: set.description,
        lastUsedIn: set.lastUsedIn,
        styleCount: styles.length,
        skuCount,
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
      /** Whole products. Kept for callers that do not deal in variations. */
      styleIds?: string[];
      /**
       * Variation-level membership. Takes precedence over styleIds for any
       * style it names, so a caller may mix the two: three whole products
       * and two sizes of a fourth.
       */
      styles?: { styleId: string; variationIds?: string[] }[];
    };

    const name = body.name?.trim();
    if (!name) return badRequest("A style set needs a name");

    // Normalise both shapes into one list of rows to create.
    const rows: { styleId: string; variationId: string | null }[] = [];
    const seen = new Set<string>();

    for (const entry of body.styles ?? []) {
      if (!entry.styleId) continue;
      const ids = entry.variationIds ?? [];
      if (ids.length === 0) {
        // No variations named means the whole product — the same thing a
        // bare styleId means.
        const key = `${entry.styleId}|${WHOLE_STYLE_KEY}`;
        if (!seen.has(key)) {
          seen.add(key);
          rows.push({ styleId: entry.styleId, variationId: null });
        }
        continue;
      }
      for (const variationId of ids) {
        const key = `${entry.styleId}|${variationId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push({ styleId: entry.styleId, variationId });
      }
    }

    for (const styleId of body.styleIds ?? []) {
      // A style already carried by `styles` keeps its variation rows; adding
      // a whole-product row beside them would mean both "all of it" and
      // "these three", which is a contradiction the set cannot hold.
      if ([...seen].some((k) => k.startsWith(`${styleId}|`))) continue;
      const key = `${styleId}|${WHOLE_STYLE_KEY}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ styleId, variationId: null });
    }

    if (!rows.length) return badRequest("A style set needs at least one product");

    // A name collision is the user's to resolve — two sets called "Bedding
    // priority" is how you lose track of which one an RFP came from.
    const clash = await db.styleSet.findFirst({ where: { name } });
    if (clash) return badRequest(`A style set called "${name}" already exists`);

    const set = await db.styleSet.create({
      data: {
        name,
        description: body.description?.trim() || null,
        members: {
          create: rows.map((row) => ({
            styleId: row.styleId,
            variationId: row.variationId,
            variationKey: variationKeyOf(row.variationId),
          })),
        },
      },
      include: { _count: { select: { members: true } } },
    });

    return {
      id: set.id,
      name: set.name,
      description: set.description,
      // Rows, which is products at style level and variations below it.
      styleCount: set._count.members,
    };
  });
}
