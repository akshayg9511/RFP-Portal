import { db } from "@/lib/db";
import { badRequest, handle, notFound, num, ok } from "@/lib/api";

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

/**
 * @openapi
 * /api/style-sets/{id}:
 *   patch:
 *     summary: Rename a set, re-describe it, or change its membership
 *     description: >
 *       §3.1 calls style sets "manual, reusable". A set that cannot be amended
 *       is neither — names go stale as a wave evolves, and the useful set is
 *       usually "last wave's, minus three styles".
 *     responses:
 *       200: { description: The updated set }
 *       400: { description: Empty name, or a duplicate }
 *       404: { description: No such set }
 *   delete:
 *     summary: Delete a style set
 *     description: >
 *       Refuses while an RFP still references the set's products, unless
 *       ?force=true — losing the grouping an RFP came from makes that RFP
 *       unexplainable.
 */
export function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const { id } = await params;
    const body = (await request.json()) as {
      name?: string;
      description?: string | null;
      /** Replaces membership wholesale when present. */
      styleIds?: string[];
      /** Or adjust it incrementally. */
      addStyleIds?: string[];
      removeStyleIds?: string[];
    };

    const set = await db.styleSet.findUnique({
      where: { id },
      include: { members: { select: { styleId: true } } },
    });
    if (!set) return notFound(`Style set ${id}`);

    if (body.name !== undefined) {
      const name = body.name.trim();
      if (!name) return badRequest("A style set needs a name");
      const clash = await db.styleSet.findFirst({
        where: { name, id: { not: id } },
      });
      if (clash) return badRequest(`A style set called "${name}" already exists`);
    }

    // Work out the target membership, whichever way the caller expressed it.
    let target: string[] | null = null;
    if (body.styleIds) {
      target = [...new Set(body.styleIds)];
    } else if (body.addStyleIds || body.removeStyleIds) {
      const current = new Set(set.members.map((m) => m.styleId));
      for (const sid of body.addStyleIds ?? []) current.add(sid);
      for (const sid of body.removeStyleIds ?? []) current.delete(sid);
      target = [...current];
    }

    if (target && target.length === 0) {
      // An empty set is not a grouping. Deleting is the honest action, and it
      // has its own endpoint with its own guard.
      return badRequest(
        "A style set cannot be emptied — delete it instead if it is no longer useful",
      );
    }

    await db.$transaction([
      db.styleSet.update({
        where: { id },
        data: {
          ...(body.name !== undefined ? { name: body.name.trim() } : {}),
          ...(body.description !== undefined
            ? { description: body.description?.trim() || null }
            : {}),
        },
      }),
      ...(target
        ? [
            db.styleSetMember.deleteMany({ where: { styleSetId: id } }),
            db.styleSetMember.createMany({
              data: target.map((styleId) => ({ styleSetId: id, styleId })),
            }),
          ]
        : []),
    ]);

    const updated = await db.styleSet.findUnique({
      where: { id },
      include: { _count: { select: { members: true } } },
    });

    return {
      id: updated!.id,
      name: updated!.name,
      description: updated!.description,
      styleCount: updated!._count.members,
    };
  });
}

export function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const { id } = await params;
    const force = new URL(request.url).searchParams.get("force") === "true";

    const set = await db.styleSet.findUnique({
      where: { id },
      include: { members: { select: { styleId: true } } },
    });
    if (!set) return notFound(`Style set ${id}`);

    // Warn rather than vanish: an RFP built from this set becomes
    // unexplainable once the grouping is gone.
    const usedBy = await db.rfp.findMany({
      where: { styles: { some: { styleId: { in: set.members.map((m) => m.styleId) } } } },
      select: { name: true },
      take: 5,
    });

    if (usedBy.length && !force) {
      return badRequest(
        `${usedBy.length} RFP${usedBy.length === 1 ? " uses" : "s use"} products from this set (${usedBy
          .map((r) => r.name)
          .join(", ")}). Delete anyway with ?force=true.`,
      );
    }

    // Members cascade on the relation, so the set alone is enough.
    await db.styleSet.delete({ where: { id } });
    return { id, deleted: true, warnedAbout: usedBy.length };
  });
}
