import { db } from "@/lib/db";
import { badRequest, notFound, ok } from "@/lib/api";
import { grainGroups, variationKeyOf, WHOLE_STYLE_KEY, type Grain } from "@/domain/grain";
import { resolveTemplate } from "@/lib/templates";

/**
 * @openapi
 * /api/rfps/{id}/styles:
 *   post:
 *     summary: Add products to a DRAFT RFP
 *     description: >
 *       UX v2 (Akshay, 8 Oct): a draft RFP can take more products after it is
 *       created. Each product must resolve to the RFP's quotation template —
 *       one that does not is returned in `skipped` with the template it would
 *       use, and is not added. A product goes out on every bid group of its
 *       grain, exactly as at create. Products already on the RFP are ignored.
 *     responses:
 *       200: { description: "{ added: string[], skipped: { styleNumber, reason }[] }" }
 *       400: { description: Not a draft, or nothing to add }
 *   delete:
 *     summary: Remove a product from a DRAFT RFP
 *     description: >
 *       Query `styleId`. Also drops it from every vendor nominated on this RFP,
 *       so no invitation is left holding a product the RFP no longer has.
 */

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json()) as { styleIds?: string[] };
  const styleIds = [...new Set(body.styleIds ?? [])];
  if (!styleIds.length) return badRequest("Choose at least one product");

  try {
    const rfp = await db.rfp.findUnique({
      where: { id },
      select: { status: true, templateId: true, styles: { select: { styleId: true } } },
    });
    if (!rfp) return notFound(`RFP ${id}`);
    if (rfp.status !== "DRAFT") {
      return badRequest("Products can only be added while the RFP is a draft");
    }

    const [styles, templates] = await Promise.all([
      db.style.findMany({
        where: { id: { in: styleIds } },
        select: {
          id: true,
          styleNumber: true,
          division: true,
          department: true,
          subDepartment: true,
          variationLevel: true,
          variations: {
            select: { id: true, size: true, sizeSortOrder: true, colour: true },
          },
        },
      }),
      db.template.findMany({ where: { published: true } }),
    ]);

    const onRfp = new Set(rfp.styles.map((s) => s.styleId));
    const added: string[] = [];
    const skipped: { styleNumber: string; reason: string }[] = [];
    const rows: { rfpId: string; styleId: string; variationId: string | null; variationKey: string }[] = [];

    for (const s of styles) {
      if (onRfp.has(s.id)) {
        skipped.push({ styleNumber: s.styleNumber, reason: "already on this RFP" });
        continue;
      }
      const template = resolveTemplate(s, templates);
      if (!template || template.id !== rfp.templateId) {
        skipped.push({
          styleNumber: s.styleNumber,
          reason: template
            ? `uses a different quotation template (${template.name})`
            : "has no quotation template",
        });
        continue;
      }
      const grain = s.variationLevel as Grain;
      const groups = grain === "STYLE" ? [] : grainGroups(grain, s.variations);
      if (!groups.length) {
        rows.push({ rfpId: id, styleId: s.id, variationId: null, variationKey: WHOLE_STYLE_KEY });
      } else {
        for (const g of groups) {
          const variationId = g.variationIds[0];
          rows.push({ rfpId: id, styleId: s.id, variationId, variationKey: variationKeyOf(variationId) });
        }
      }
      added.push(s.id);
    }

    if (rows.length) {
      await db.rfpStyle.createMany({ data: rows, skipDuplicates: true });
      await db.activityLog.create({
        data: {
          entity: "RFP",
          entityId: id,
          action: "PRODUCTS_ADDED",
          actorSide: "QUINCE",
          detail: { styleIds: added } as never,
        },
      });
    }

    return ok({ added, skipped });
  } catch (error) {
    console.error("[api/rfps/[id]/styles POST]", error);
    return Response.json({ error: "server_error", message: String(error) }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const styleId = new URL(request.url).searchParams.get("styleId");
  if (!styleId) return badRequest("Which product?");

  try {
    const rfp = await db.rfp.findUnique({
      where: { id },
      select: { status: true, _count: { select: { styles: true } } },
    });
    if (!rfp) return notFound(`RFP ${id}`);
    if (rfp.status !== "DRAFT") {
      return badRequest("Products can only be removed while the RFP is a draft");
    }

    const remaining = await db.rfpStyle.count({ where: { rfpId: id, styleId: { not: styleId } } });
    if (remaining === 0) return badRequest("An RFP needs at least one product");

    await db.invitationStyle.deleteMany({ where: { styleId, invitation: { rfpId: id } } });
    await db.rfpStyle.deleteMany({ where: { rfpId: id, styleId } });

    return ok({ removed: styleId });
  } catch (error) {
    console.error("[api/rfps/[id]/styles DELETE]", error);
    return Response.json({ error: "server_error", message: String(error) }, { status: 500 });
  }
}
