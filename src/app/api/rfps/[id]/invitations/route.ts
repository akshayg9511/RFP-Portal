import { db } from "@/lib/db";
import { badRequest, ok } from "@/lib/api";
import { variationKeyOf, WHOLE_STYLE_KEY } from "@/domain/grain";

/**
 * @openapi
 * /api/rfps/{id}/invitations:
 *   put:
 *     summary: Set which vendors are nominated, and each one's product subset
 *     description: >
 *       Idempotent. Send the full desired set; vendors absent from it are
 *       removed. Each vendor's subset defaults to every product in the RFP and
 *       is fully adjustable — vendor A may get products 1-4, vendor C only 1-3.
 *     responses:
 *       200: { description: The resulting invitations }
 *       400: { description: A vendor already bids on one of these products }
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json()) as {
    invitations?: {
      vendorId: string;
      styleIds: string[];
      /**
       * Which variations this vendor was asked for, by styleId. A style
       * absent from the map goes out WHOLE — the same thing a bare styleId
       * has always meant, so a style-grained RFP is unaffected.
       */
      variationsByStyle?: Record<string, string[]>;
    }[];
  };
  const wanted = body.invitations ?? [];

  try {
    const rfp = await db.rfp.findUnique({
      where: { id },
      include: { styles: { select: { styleId: true } } },
    });
    if (!rfp) return badRequest("No such RFP");

    // An invitation cannot carry a product the RFP does not contain.
    const inScope = new Set(rfp.styles.map((s) => s.styleId));
    for (const inv of wanted) {
      if (!inv.styleIds.length) {
        return badRequest("Every nominated vendor needs at least one product");
      }
      if (inv.styleIds.some((sid) => !inScope.has(sid))) {
        return badRequest("A product outside this RFP was assigned to a vendor");
      }
    }

    /**
     * Build Doc §5.3: one PRODUCT may appear in only one RFP per vendor.
     *
     * This used to reject the whole request if a vendor clashed on ANY product,
     * which made the screen unusable and silently lost work: the client already
     * hands a vendor only their non-clashing products, so a vendor with 1 of 2
     * legal products was refused outright, nothing persisted, and issuing then
     * said "Nominate at least one vendor" on an RFP that looked fully staffed.
     *
     * The rule is per product, so the save is too: drop the clashing styleIds,
     * keep the rest, and report what was held back so the UI can say WHY a
     * vendor has 1 of 2 rather than leaving it unexplained.
     */
    const clashRows = await db.invitation.findMany({
      where: {
        rfpId: { not: id },
        vendorId: { in: wanted.map((w) => w.vendorId) },
        styles: { some: { styleId: { in: [...inScope] } } },
      },
      select: {
        vendorId: true,
        rfp: { select: { name: true } },
        vendor: { select: { name: true } },
        styles: { select: { styleId: true } },
      },
    });

    // vendorId|styleId -> the RFP already holding it.
    const heldBy = new Map<string, { rfpName: string; vendorName: string }>();
    for (const row of clashRows) {
      for (const st of row.styles) {
        if (!inScope.has(st.styleId)) continue;
        heldBy.set(`${row.vendorId}|${st.styleId}`, {
          rfpName: row.rfp.name,
          vendorName: row.vendor.name,
        });
      }
    }

    const heldBack: {
      vendorId: string;
      vendorName: string;
      styleId: string;
      rfpName: string;
    }[] = [];

    const allowed: {
      vendorId: string;
      styleIds: string[];
      variationsByStyle?: Record<string, string[]>;
    }[] = [];
    const fullyBlocked: { vendorName: string; rfpName: string }[] = [];

    for (const inv of wanted) {
      const keep: string[] = [];
      for (const styleId of inv.styleIds) {
        const held = heldBy.get(`${inv.vendorId}|${styleId}`);
        if (held) {
          heldBack.push({
            vendorId: inv.vendorId,
            vendorName: held.vendorName,
            styleId,
            rfpName: held.rfpName,
          });
        } else {
          keep.push(styleId);
        }
      }

      // A vendor with nothing legal left cannot be invited at all — an
      // invitation carrying no products is not a nomination.
      if (keep.length) {
        // Carry the variation narrowing through, scoped to the styles that
        // survived the clash check — a held-back style must not smuggle its
        // variations past the filter.
        const variationsByStyle: Record<string, string[]> = {};
        for (const styleId of keep) {
          const picked = inv.variationsByStyle?.[styleId];
          if (picked?.length) variationsByStyle[styleId] = picked;
        }
        allowed.push({
          vendorId: inv.vendorId,
          styleIds: keep,
          variationsByStyle,
        });
      }
      else {
        const first = heldBack.find((h) => h.vendorId === inv.vendorId);
        if (first) {
          fullyBlocked.push({
            vendorName: first.vendorName,
            rfpName: first.rfpName,
          });
        }
      }
    }

    const existing = await db.invitation.findMany({ where: { rfpId: id } });
    // Vendors kept are those with at least one legal product — a fully blocked
    // vendor is not nominated, so an existing invitation for them is removed.
    const wantedIds = new Set(allowed.map((w) => w.vendorId));

    /**
     * REMOVALS ARE A DRAFT-ONLY ACTION, AND THE ROUTE ENFORCES IT.
     *
     * This used to delete any vendor the payload omitted, on the reasoning
     * that "the screen only sends removals for draft RFPs". The screen does
     * — but the route TRUSTED that rather than checking it, and
     * `Quote.invitation` is `onDelete: Cascade`, so one PUT that omitted a
     * vendor silently destroyed their submitted bids.
     *
     * I did exactly that to Akshay's test RFP while verifying the K4 fix: a
     * PUT naming one vendor removed the others and cascaded their quotes. A
     * stale browser tab could do the same, which makes it a real defect
     * rather than only my mistake.
     *
     * Withdrawing a vendor after issue is a state change with a
     * notification attached — the §5.5 addendum flow, deliberately out of
     * scope. Until that exists, an issued RFP keeps its vendors.
     */
    const canRemove = rfp.status === "DRAFT";

    for (const inv of existing) {
      if (!wantedIds.has(inv.vendorId)) {
        if (!canRemove) {
          return badRequest(
            "This RFP has been issued, so a vendor cannot be removed here. " +
              "Their bid would be deleted with them.",
          );
        }
        await db.invitation.delete({ where: { id: inv.id } });
      }
    }

    for (const inv of allowed) {
      const invitation = await db.invitation.upsert({
        where: { rfpId_vendorId: { rfpId: id, vendorId: inv.vendorId } },
        create: { rfpId: id, vendorId: inv.vendorId, status: "NOT_STARTED" },
        update: {},
      });

      // Reset the subset to exactly what was sent.
      await db.invitationStyle.deleteMany({
        where: { invitationId: invitation.id },
      });

      /**
       * WHAT THE RFP CARRIES, PER PRODUCT.
       *
       * The fallback below used to send a product WHOLE whenever the client
       * named no variations for it. That is right for a style-grained
       * product and wrong for every other: the RFP already carries the
       * variations (RfpStyle), so going out whole silently discards them and
       * the vendor is asked to quote one price for a product Quince prices
       * per size.
       *
       * Found via Akshay's report of "I do not see all variants": the RFP
       * had all 5 sizes on RfpStyle, the invitation had one style-level row,
       * and the seed gate's grain check flagged the resulting quote.
       */
      const rfpVariations = new Map<string, string[]>();
      for (const row of await db.rfpStyle.findMany({
        where: { rfpId: id, variationId: { not: null } },
        select: { styleId: true, variationId: true },
      })) {
        const list = rfpVariations.get(row.styleId) ?? [];
        list.push(row.variationId!);
        rfpVariations.set(row.styleId, list);
      }
      // One row per product, or one per NOMINATED VARIATION where the buyer
      // narrowed it. A product absent from variationsByStyle goes out whole,
      // with variationKey '@STYLE' — which is what every pre-1.6 row means.
      await db.invitationStyle.createMany({
        data: inv.styleIds.flatMap((styleId) => {
          // What the buyer picked, else everything this RFP holds for the
          // product. Empty only for a genuinely style-grained product.
          const variationIds =
            inv.variationsByStyle?.[styleId]?.length
              ? inv.variationsByStyle[styleId]
              : (rfpVariations.get(styleId) ?? []);
          if (!variationIds.length) {
            return [
              {
                invitationId: invitation.id,
                styleId,
                variationId: null as string | null,
                variationKey: WHOLE_STYLE_KEY,
              },
            ];
          }
          return variationIds.map((variationId) => ({
            invitationId: invitation.id,
            styleId,
            variationId: variationId as string | null,
            variationKey: variationKeyOf(variationId),
          }));
        }),
      });
    }

    const result = await db.invitation.findMany({
      where: { rfpId: id },
      include: {
        vendor: { select: { name: true } },
        styles: { select: { styleId: true } },
      },
    });

    return ok({
      invitations: result.map((i) => ({
        id: i.id,
        vendorId: i.vendorId,
        vendorName: i.vendor.name,
        styleIds: i.styles.map((s) => s.styleId),
      })),
      /**
       * What §5.3 refused, per product. The screen names the product and the
       * RFP holding it, so "1 of 2" is never unexplained — that silence is
       * what hid this bug.
       */
      heldBack,
      /** Vendors with no legal product left, so not nominated at all. */
      fullyBlocked,
    });
  } catch (error) {
    console.error("[api/rfps/[id]/invitations]", error);
    return Response.json(
      { error: "server_error", message: String(error) },
      { status: 500 },
    );
  }
}
