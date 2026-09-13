import { db } from "@/lib/db";
import { notFound, num, ok } from "@/lib/api";

/**
 * @openapi
 * /api/rfps/{id}:
 *   get:
 *     summary: One RFP with its products, vendors and candidate vendors
 *     description: >
 *       Everything the nomination screen needs in one call. Candidates are
 *       split by source — incumbents on these styles first, then the rest of
 *       the master. "Recommended" (the vendor x category mapping) is V1.
 *     responses:
 *       200: { description: The RFP }
 *       404: { description: No such RFP }
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const rfp = await db.rfp.findUnique({
      where: { id },
      include: {
        template: true,
        wave: { select: { name: true, dueDate: true } },
        styles: {
          include: {
            style: {
              include: {
                images: {
                  where: { isHero: true },
                  take: 1,
                  select: { url: true },
                },
                currentSuppliers: { select: { vendorId: true } },
              },
            },
          },
        },
        invitations: {
          include: {
            vendor: true,
            styles: { select: { styleId: true } },
          },
        },
      },
    });

    if (!rfp) return notFound(`RFP ${id}`);

    const styleIds = rfp.styles.map((s) => s.styleId);

    // Who currently supplies any style in this RFP — offered first, because
    // they are the vendors with the most context on the product.
    const incumbentIds = new Set(
      rfp.styles.flatMap((s) => s.style.currentSuppliers.map((c) => c.vendorId)),
    );

    const vendors = await db.vendor.findMany({ orderBy: { name: "asc" } });

    // Build Doc §5.3: one product may appear in only one RFP per vendor at a
    // time. Anything already invited elsewhere in this wave is flagged so the
    // screen can say why a vendor is unavailable rather than silently hiding.
    const elsewhere = await db.invitation.findMany({
      where: {
        rfpId: { not: id },
        styles: { some: { styleId: { in: styleIds } } },
      },
      select: { vendorId: true, styles: { select: { styleId: true } } },
    });
    const clash = new Map<string, string[]>();
    for (const inv of elsewhere) {
      const hits = inv.styles
        .map((s) => s.styleId)
        .filter((sid) => styleIds.includes(sid));
      if (hits.length) clash.set(inv.vendorId, hits);
    }

    const invited = new Set(rfp.invitations.map((i) => i.vendorId));

    return ok({
      id: rfp.id,
      name: rfp.name,
      status: rfp.status,
      instructions: rfp.instructions,
      dueDate: rfp.dueDate,
      sourcingPartner: rfp.sourcingPartner,
      gm: rfp.gm,
      templateName: rfp.template.name,
      waveName: rfp.wave.name,

      styles: rfp.styles.map((rs) => ({
        id: rs.style.id,
        styleNumber: rs.style.styleNumber,
        name: rs.style.name,
        subDepartment: rs.style.subDepartment,
        heroImage: rs.style.images[0]?.url ?? null,
        planUnits: rs.style.planUnits,
        baselineFob: num(rs.style.baselineFob),
      })),

      invitations: rfp.invitations.map((inv) => ({
        id: inv.id,
        vendorId: inv.vendor.id,
        vendorName: inv.vendor.name,
        vendorCode: inv.vendor.vendorCode,
        cooRegion: inv.vendor.cooRegion,
        isNewToQuince: inv.vendor.isNewToQuince,
        isTemp: inv.vendor.isTemp,
        status: inv.status,
        styleIds: inv.styles.map((s) => s.styleId),
      })),

      candidates: vendors.map((v) => ({
        id: v.id,
        vendorCode: v.vendorCode,
        name: v.name,
        countryIso: v.countryIso,
        cooRegion: v.cooRegion,
        isNewToQuince: v.isNewToQuince,
        isTemp: v.isTemp,
        source: incumbentIds.has(v.id) ? "INCUMBENT" : "SEARCH",
        alreadyInvited: invited.has(v.id),
        clashingStyleIds: clash.get(v.id) ?? [],
      })),
    });
  } catch (error) {
    console.error("[api/rfps/[id]]", error);
    return Response.json(
      { error: "server_error", message: String(error) },
      { status: 500 },
    );
  }
}

/**
 * @openapi
 * /api/rfps/{id}:
 *   patch:
 *     summary: Update RFP settings — name, instructions, due date, owners
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json()) as {
    name?: string;
    instructions?: string;
    dueDate?: string | null;
    sourcingPartner?: string | null;
    gm?: string | null;
  };

  try {
    const rfp = await db.rfp.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.instructions !== undefined
          ? { instructions: body.instructions.trim() || null }
          : {}),
        ...(body.dueDate !== undefined
          ? { dueDate: body.dueDate ? new Date(body.dueDate) : null }
          : {}),
        ...(body.sourcingPartner !== undefined
          ? { sourcingPartner: body.sourcingPartner }
          : {}),
        ...(body.gm !== undefined ? { gm: body.gm } : {}),
      },
    });

    return ok({ id: rfp.id, name: rfp.name });
  } catch (error) {
    console.error("[api/rfps/[id] PATCH]", error);
    return Response.json(
      { error: "server_error", message: String(error) },
      { status: 500 },
    );
  }
}
