import { db } from "@/lib/db";
import { badRequest, notFound, num, ok } from "@/lib/api";
import { vendorSignals, type VendorSignals } from "@/domain/scoring";
import { termsFromValues } from "@/domain/terms";
import { addressedByChange, type Ask as DomainAsk } from "@/domain/asks";

/**
 * @openapi
 * /api/quotes/{invitationId}/{styleId}:
 *   get:
 *     summary: The quote form — template, product, and any saved values
 *     description: >
 *       Returns the template definition so the form renders from data, plus
 *       whatever the vendor has already entered. INTERNAL FIELDS ARE NEVER
 *       INCLUDED: no clean sheet, no baseline, no other vendor's numbers.
 *   put:
 *     summary: Save or submit the quote
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ invitationId: string; styleId: string }> },
) {
  const { invitationId, styleId } = await params;

  try {
    const invitation = await db.invitation.findUnique({
      where: { id: invitationId },
      include: {
        rfp: { include: { template: true } },
        vendor: { select: { id: true, name: true } },
        styles: { where: { styleId }, select: { styleId: true, cannotBid: true } },
      },
    });

    if (!invitation) return notFound(`Invitation ${invitationId}`);
    if (!invitation.styles.length) {
      return notFound(`That product is not in this invitation`);
    }

    const style = await db.style.findUnique({
      where: { id: styleId },
      select: {
        id: true,
        styleNumber: true,
        name: true,
        material: true,
        variationLevel: true,
        planUnits: true,
        // The full set — a vendor pricing a product should be able to look at
        // it. Every route but one used to return a single hero image.
        images: { orderBy: { position: "asc" }, select: { url: true, isHero: true } },
        colourways: {
          orderBy: { name: "asc" },
          select: {
            id: true,
            name: true,
            images: { orderBy: { position: "asc" }, select: { url: true } },
          },
        },
        variations: {
          orderBy: [{ sizeSortOrder: "asc" }],
          select: { size: true },
        },
      },
    });
    if (!style) return notFound(`Style ${styleId}`);

    const quote = await db.quote.findFirst({
      where: { invitationId, styleId, round: invitation.currentRound },
    });

    // Every product in this invitation, so the form can offer product
    // navigation without a second call.
    const siblings = await db.invitationStyle.findMany({
      where: { invitationId },
      include: { style: { select: { id: true, styleNumber: true, name: true } } },
    });
    const quotes = await db.quote.findMany({
      where: { invitationId },
      select: { styleId: true, status: true },
    });
    const stateByStyle = new Map(quotes.map((q) => [q.styleId, q.status]));

    /**
     * The vendor's signal. Computed here rather than in the browser because the
     * inputs — the clean sheet and every rival's FOB — must never reach a
     * vendor screen. Only the verdict travels.
     *
     * Only on a SUBMITTED quote: showing a band while someone is still typing
     * would turn the form into a guessing game against the clean sheet.
     */
    let signals: VendorSignals | null = null;
    if (quote?.status === "SUBMITTED" && quote.fob) {
      const [cleanSheet, rivals, styleCost] = await Promise.all([
        db.cleanSheet.findMany({
          // Style-level target only — see the note in styles/[id]/bids.
          // Unfiltered, the vendor score panel compares a bid against the
          // sum of every size's target.
          where: { styleId, kind: "CLEAN_SHEET", variationId: null },
          select: { bucket: true, amount: true },
        }),
        db.quote.findMany({
          where: { styleId, status: "SUBMITTED" },
          select: { fob: true },
        }),
        db.style.findUnique({
          where: { id: styleId },
          select: { baselineFob: true },
        }),
      ]);

      const cleanSheetBuckets: Record<string, number> = {};
      for (const row of cleanSheet) {
        cleanSheetBuckets[row.bucket] =
          (cleanSheetBuckets[row.bucket] ?? 0) + (num(row.amount) ?? 0);
      }
      const cleanSheetFob = Object.values(cleanSheetBuckets).reduce(
        (a, b) => a + b,
        0,
      );

      // A style with no clean sheet has nothing to measure against, and an
      // invented target would be worse than no signal at all.
      if (cleanSheetFob > 0) {
        signals = vendorSignals({
          bidFob: num(quote.fob) ?? 0,
          bidBuckets: (quote.bucketTotals ?? {}) as Record<string, number>,
          baselineFob: num(styleCost?.baselineFob ?? null) ?? 0,
          cleanSheetFob,
          cleanSheetBuckets,
          allBidFobs: rivals
            .map((r) => num(r.fob))
            .filter((f): f is number => f !== null),
        });
      }
    }

    /**
     * The Asks on this product. The vendor sees the target as a PERCENTAGE
     * RANGE, which is how procurement set it — never a derived absolute price,
     * because that would hand them the should-cost figure the bands exist to
     * withhold (Build Doc 8.2).
     */
    const asks = await db.ask.findMany({
      where: { invitationId, styleId },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      select: {
        id: true, anchor: true, bucket: true, fieldPath: true, type: true,
        body: true, targetPctLo: true, targetPctHi: true, status: true,
        mandatory: true, valueBefore: true, valueAfter: true, reply: true,
      },
    });

    return ok({
      asks: asks.map((a) => ({
        ...a,
        targetPctLo: num(a.targetPctLo),
        targetPctHi: num(a.targetPctHi),
      })),
      // Bands and directions only — never the values behind them.
      signals,
      invitationId,
      round: invitation.currentRound,
      vendor: invitation.vendor,
      rfp: {
        id: invitation.rfp.id,
        name: invitation.rfp.name,
        instructions: invitation.rfp.instructions,
        dueDate: invitation.rfp.dueDate,
      },
      template: {
        name: invitation.rfp.template.name,
        definition: invitation.rfp.template.definition,
      },
      style: {
        id: style.id,
        styleNumber: style.styleNumber,
        name: style.name,
        material: style.material,
        variationLevel: style.variationLevel,
        planUnits: style.planUnits,
        heroImage: style.images.find((i) => i.isHero)?.url ?? null,
      images: style.images.map((i) => i.url),
      colourways: style.colourways.map((c) => ({
        id: c.id,
        name: c.name,
        images: c.images.map((i) => i.url),
      })),
        sizes: [...new Set(style.variations.map((v) => v.size).filter(Boolean))],
      },
      quote: quote
        ? {
            status: quote.status,
            values: quote.values,
            // The stored totals — Materials and Crafting come through a
            // FORMULA, so summing the raw money lines under a section
            // understates them.
            bucketTotals: quote.bucketTotals,
            fob: num(quote.fob),
            dutyType: quote.dutyType,
            moq: quote.moq,
            productionLeadTime: quote.productionLeadTime,
            maxVolumeCapacity: quote.maxVolumeCapacity,
            notes: quote.notes,
          }
        : null,
      products: siblings.map((s) => ({
        id: s.style.id,
        styleNumber: s.style.styleNumber,
        name: s.style.name,
        cannotBid: s.cannotBid,
        state: stateByStyle.get(s.styleId) ?? "BLANK",
      })),
    });
  } catch (error) {
    console.error("[api/quotes GET]", error);
    return Response.json(
      { error: "server_error", message: String(error) },
      { status: 500 },
    );
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ invitationId: string; styleId: string }> },
) {
  const { invitationId, styleId } = await params;
  const body = (await request.json()) as {
    values?: Record<string, unknown>;
    bucketTotals?: Record<string, number>;
    fob?: number;
    status?: "DRAFT" | "SUBMITTED";
    dutyType?: string | null;
    moq?: number | null;
    productionLeadTime?: number | null;
    maxVolumeCapacity?: number | null;
    notes?: string | null;
    cannotBid?: boolean;
    cannotBidReason?: string | null;
  };

  try {
    const invitation = await db.invitation.findUnique({
      where: { id: invitationId },
      select: { id: true, vendorId: true, currentRound: true },
    });
    if (!invitation) return badRequest("No such invitation");

    if (body.cannotBid !== undefined) {
      await db.invitationStyle.updateMany({
        where: { invitationId, styleId },
        data: {
          cannotBid: body.cannotBid,
          cannotBidReason: body.cannotBidReason ?? null,
        },
      });
    }

    const status = body.status ?? "DRAFT";

    const quote = await db.quote.upsert({
      where: {
        invitationId_styleId_round: {
          invitationId,
          styleId,
          round: invitation.currentRound,
        },
      },
      create: {
        invitationId,
        styleId,
        vendorId: invitation.vendorId,
        round: invitation.currentRound,
        status,
        values: (body.values ?? {}) as never,
        bucketTotals: (body.bucketTotals ?? {}) as never,
        fob: body.fob ?? null,
        dutyType: body.dutyType ?? null,
        ...termsFromValues((body.values ?? {}) as Record<string, unknown>, body),
        submittedAt: status === "SUBMITTED" ? new Date() : null,
      },
      update: {
        status,
        values: (body.values ?? {}) as never,
        bucketTotals: (body.bucketTotals ?? {}) as never,
        fob: body.fob ?? null,
        // dutyType is only overwritten when the caller actually supplies it —
        // it decides whether a bid is DDP, and nulling it changes Best Cost.
        ...(body.dutyType !== undefined ? { dutyType: body.dutyType } : {}),
        ...termsFromValues((body.values ?? {}) as Record<string, unknown>, body),
        ...(status === "SUBMITTED" ? { submittedAt: new Date() } : {}),
      },
    });

    /**
     * AUTO-ADDRESS — the mechanic that makes an Ask not a comment box.
     *
     * An Ask anchored to a bucket or a line item marks itself ADDRESSED the
     * moment the vendor changes that value, recording before and after. Nobody
     * clicks anything and nobody chases. Procurement still decides whether the
     * move was FAR ENOUGH (RESOLVED / REOPENED) — see PATCH /api/asks/[id].
     *
     * Runs on draft saves as well as submits: a vendor working through feedback
     * should see their Asks turn over as they go.
     */
    const openAsks = await db.ask.findMany({
      where: {
        invitationId,
        styleId,
        status: { in: ["OPEN", "ADDRESSED", "REOPENED"] },
      },
    });

    if (openAsks.length) {
      const transitions = addressedByChange(
        openAsks.map(
          (a): DomainAsk => ({
            id: a.id,
            anchor: a.anchor as DomainAsk["anchor"],
            styleId: a.styleId,
            bucket: a.bucket,
            fieldPath: a.fieldPath,
            type: a.type as DomainAsk["type"],
            body: a.body,
            targetPctLo: a.targetPctLo === null ? null : Number(a.targetPctLo),
            targetPctHi: a.targetPctHi === null ? null : Number(a.targetPctHi),
            status: a.status as DomainAsk["status"],
            mandatory: a.mandatory,
            valueBefore: a.valueBefore,
            valueAfter: a.valueAfter,
          }),
        ),
        {
          buckets: (body.bucketTotals ?? {}) as Record<string, number>,
          fields: (body.values ?? {}) as Record<string, unknown>,
        },
      );

      if (transitions.length) {
        await db.$transaction(
          transitions.map((t) =>
            db.ask.update({
              where: { id: t.id },
              data: {
                status: t.status,
                valueBefore: t.valueBefore,
                valueAfter: t.valueAfter,
              },
            }),
          ),
        );
      }
    }

    // The invitation follows its quotes: anything entered moves it off
    // NOT_STARTED, and it reads SUBMITTED once every product is in.
    const [total, submitted] = await Promise.all([
      db.invitationStyle.count({ where: { invitationId } }),
      db.quote.count({ where: { invitationId, status: "SUBMITTED" } }),
    ]);
    await db.invitation.update({
      where: { id: invitationId },
      data: {
        status:
          submitted >= total
            ? "SUBMITTED"
            : submitted > 0 || status === "DRAFT"
              ? "IN_PROGRESS"
              : "NOT_STARTED",
      },
    });

    if (status === "SUBMITTED") {
      await db.activityLog.create({
        data: {
          entity: "QUOTE",
          entityId: quote.id,
          styleId,
          vendorId: invitation.vendorId,
          action: "SUBMITTED",
          actorSide: "VENDOR",
          detail: { fob: body.fob } as never,
        },
      });
    }

    return ok({
      id: quote.id,
      status: quote.status,
      fob: num(quote.fob),
      submittedCount: submitted,
      productCount: total,
    });
  } catch (error) {
    console.error("[api/quotes PUT]", error);
    return Response.json(
      { error: "server_error", message: String(error) },
      { status: 500 },
    );
  }
}
