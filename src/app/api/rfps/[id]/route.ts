import { db } from "@/lib/db";
import { grainGroups, type Grain } from "@/domain/grain";
import { notFound, num, ok } from "@/lib/api";
import { cleanOwners, ownerList, ownersData } from "@/lib/owners";

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
            // Which variation this row put out to bid. NULL = the whole
            // product.
            variation: {
              select: { id: true, size: true, colour: true, sizeSortOrder: true },
            },
            style: {
              include: {
                images: {
                  where: { isHero: true },
                  take: 1,
                  select: { url: true },
                },
                // Style-level rows only, or each supplier appears once per
                // variation — the same defect fixed across five read sites
                // in 1.5a.
                currentSuppliers: {
                  where: { variationId: null },
                  select: { vendorId: true },
                },
                variations: {
                  orderBy: [
                    { sizeSortOrder: "asc" },
                    { size: "asc" },
                    { colour: "asc" },
                  ],
                  select: {
                    id: true,
                    size: true,
                    sizeSortOrder: true,
                    colour: true,
                    baselineFob: true,
                  },
                },
              },
            },
          },
        },
        invitations: {
          include: {
            vendor: true,
            styles: { select: { styleId: true, variationId: true } },
            // Per-product state, so a vendor row can say which products are
            // still pending and open the ones that are in.
            quotes: { select: { styleId: true, status: true, fob: true } },
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

    // One bucket per product, holding every RfpStyle row for it.
    const groupedStyles = new Map<string, typeof rfp.styles>();
    for (const row of rfp.styles) {
      const bucket = groupedStyles.get(row.styleId);
      if (bucket) bucket.push(row);
      else groupedStyles.set(row.styleId, [row]);
    }

    return ok({
      id: rfp.id,
      name: rfp.name,
      status: rfp.status,
      instructions: rfp.instructions,
      dueDate: rfp.dueDate,
      sourcingPartner: rfp.sourcingPartner,
      gm: rfp.gm,
      sourcingPartners: ownerList(rfp.sourcingPartners, rfp.sourcingPartner),
      gms: ownerList(rfp.gms, rfp.gm),
      templateName: rfp.template.name,
      waveName: rfp.wave.name,

      // ONE entry per product, carrying the variations that went out.
      // Mapping rfp.styles directly would list a product once per size —
      // the row-vs-product defect already fixed in style sets and RFP
      // counts.
      styles: [...groupedStyles.values()].map((rows) => {
        const first = rows[0];
        return {
          id: first.style.id,
          styleNumber: first.style.styleNumber,
          name: first.style.name,
          subDepartment: first.style.subDepartment,
          heroImage: first.style.images[0]?.url ?? null,
          planUnits: first.style.planUnits,
          baselineFob: num(first.style.baselineFob),
          /**
           * EVERY variation the product has, at its grain — the set a buyer
           * chooses FROM when nominating.
           *
           * 1.5e returned only the variations already on the RFP, which is
           * right for "what went out" but useless for nomination: you cannot
           * pick a size that is not in the list.
           */
          variations:
            (first.style.variationLevel as Grain) === "STYLE"
              ? []
              : grainGroups(
                  first.style.variationLevel as Grain,
                  first.style.variations.map((v) => ({
                    id: v.id,
                    size: v.size,
                    sizeSortOrder: v.sizeSortOrder,
                    colour: v.colour,
                  })),
                ).map((g) => ({
                  id: g.variationIds[0],
                  label: g.label,
                  // The variant's OWN baseline. Without it the nomination
                  // panel repeated the style figure on every row, so five
                  // sizes all read $21.98 — which looks like a bug and
                  // hides the very cost spread variation level exists for.
                  baselineFob: num(
                    first.style.variations.find((v) => v.id === g.variationIds[0])
                      ?.baselineFob ?? null,
                  ),
                })),
          /** Which of them are ON the RFP. EMPTY = the whole product. */
          onRfp: rows
            .filter((r) => r.variation !== null)
            .map((r) => ({
              id: r.variation!.id,
              label:
                [r.variation!.colour, r.variation!.size]
                  .filter(Boolean)
                  .join(" / ") || "—",
              sizeSortOrder: r.variation!.sizeSortOrder,
            }))
            .sort((a, b) => (a.sizeSortOrder ?? 0) - (b.sizeSortOrder ?? 0)),
        };
      }),

      invitations: rfp.invitations.map((inv) => ({
        id: inv.id,
        vendorId: inv.vendor.id,
        vendorName: inv.vendor.name,
        vendorCode: inv.vendor.vendorCode,
        cooRegion: inv.vendor.cooRegion,
        isNewToQuince: inv.vendor.isNewToQuince,
        isTemp: inv.vendor.isTemp,
        status: inv.status,
        // DISTINCT products this vendor holds. A vendor narrowed to 3 of 5
        // sizes has 3 rows for one product, so mapping rows directly would
        // list it three times — the row-vs-product defect already fixed in
        // style sets, RFP counts and the RFP detail styles list.
        styleIds: [...new Set(inv.styles.map((s) => s.styleId))],
        /**
         * The nominated variations as `styleId|variationId` keys, which is
         * exactly the shape the nomination Set uses on the client — so the
         * edits-over-saved merge needs no translation step.
         */
        variationKeys: inv.styles
          .filter((s) => s.variationId !== null)
          .map((s) => `${s.styleId}|${s.variationId}`),
        quotes: inv.quotes.map((q) => ({
          styleId: q.styleId,
          status: q.status,
          fob: num(q.fob),
        })),
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
    /** Lists win over the single fields when both are sent. */
    sourcingPartners?: string[];
    gms?: string[];
  };

  try {
    const rfp = await db.rfp.update({
      where: { id },
      data: {
        ...ownersData(
          body.sourcingPartners !== undefined ? cleanOwners(body.sourcingPartners) : undefined,
          body.gms !== undefined ? cleanOwners(body.gms) : undefined,
        ),
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.instructions !== undefined
          ? { instructions: body.instructions.trim() || null }
          : {}),
        ...(body.dueDate !== undefined
          ? { dueDate: body.dueDate ? new Date(body.dueDate) : null }
          : {}),
        ...(body.sourcingPartner !== undefined && body.sourcingPartners === undefined
          ? {
              sourcingPartner: body.sourcingPartner,
              sourcingPartners: body.sourcingPartner ? [body.sourcingPartner] : [],
            }
          : {}),
        ...(body.gm !== undefined && body.gms === undefined
          ? { gm: body.gm, gms: body.gm ? [body.gm] : [] }
          : {}),
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
