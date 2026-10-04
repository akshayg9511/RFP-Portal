import { db } from "@/lib/db";
import { variationKeyOf } from "@/domain/grain";
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

    /**
     * EVERY quote for this vendor x product — one per variation (H8.5).
     *
     * Each variant carries the full template at line-item level, so each
     * gets its own complete row rather than a thin price record. A
     * style-grained product has exactly one row with variationKey '@STYLE',
     * which is the degenerate case of the same shape.
     */
    const variantQuotes = await db.quote.findMany({
      where: { invitationId, styleId },
    });

    /** The row the form opens on: the style-level one, else the first. */
    const quote =
      variantQuotes.find((q) => q.variationId === null) ??
      variantQuotes[0] ??
      null;

    // Which variations of THIS product this vendor was nominated for.
    // Per decision F6 the form shows only these — a size the buyer did not
    // ask for is absent, not greyed, so the vendor never learns it existed.
    const nominated = await db.invitationStyle.findMany({
      where: { invitationId, styleId, variationId: { not: null } },
      include: {
        variation: {
          select: { id: true, size: true, colour: true, sizeSortOrder: true },
        },
      },
      orderBy: { variation: { sizeSortOrder: "asc" } },
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
        /**
         * The variations THIS vendor must price, with any price already
         * saved. Per decision F6 a variation the buyer did not ask for is
         * absent entirely — the vendor never learns it was considered.
         */
        /**
         * The variations THIS vendor must price, each with its own full
         * quote where one exists. Per decision F6 a variation the buyer did
         * not ask for is absent entirely — the vendor never learns it was
         * considered.
         */
        pricedVariations: nominated.map((n) => {
          const own = variantQuotes.find(
            (q) => q.variationId === n.variationId,
          );
          return {
            id: n.variationId!,
            label:
              [n.variation!.colour, n.variation!.size]
                .filter(Boolean)
                .join(" / ") || "—",
            status: own?.status ?? null,
            fob: num(own?.fob ?? null),
            // The whole breakdown, so the form can render the full template
            // per variant and Apply-to-all has something to copy.
            values: (own?.values ?? {}) as Record<string, unknown>,
            bucketTotals: (own?.bucketTotals ?? {}) as Record<string, number>,
          };
        }),
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
      // DISTINCT products. Since nomination went per variation, a vendor
      // narrowed to 3 sizes has 3 invitationStyle rows for one product —
      // mapping them directly listed the product three times and gave React
      // duplicate keys.
      products: dedupeByStyle(siblings).map((s) => ({
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
    /**
     * Per-variation price, keyed by variation id. Only consumption and FOB
     * differ by size (F5); the rest of the breakdown is shared above.
     */
    /**
     * The variation this save is FOR. Omitted means the whole product,
     * which is what a style-grained product means.
     */
    variationId?: string | null;
    /**
     * APPLY TO ALL — copy this payload to every unsubmitted variation.
     *
     * The full template is 41 fields per variant, so a 5-size product is
     * 205 inputs; nobody types that twice. Submitted variants are never
     * overwritten.
     */
    applyToAll?: boolean;
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

    const variationId = body.variationId ?? null;
    const variationKey = variationKeyOf(variationId);

    const quote = await db.quote.upsert({
      where: {
        invitationId_styleId_variationKey: {
          invitationId,
          styleId,
          variationKey,
        },
      },
      create: {
        invitationId,
        styleId,
        vendorId: invitation.vendorId,
        variationId,
        variationKey,
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
     * APPLY TO ALL — copy this payload to every UNSUBMITTED variation.
     *
     * The full template is 41 fields per variant (H8.5), so a 5-size product
     * is 205 inputs. Copy is therefore load-bearing, not a convenience.
     *
     * Two rules that matter:
     *  - a SUBMITTED variant is never overwritten. The vendor has committed
     *    to it, and silently rewriting a submitted price is the worst thing
     *    this could do;
     *  - the copy lands as DRAFT regardless of what the source was saved as,
     *    so the vendor still reviews and submits each one deliberately.
     */
    if (body.applyToAll) {
      const nominatedVariations = await db.invitationStyle.findMany({
        where: { invitationId, styleId, variationId: { not: null } },
        select: { variationId: true },
      });

      const existing = await db.quote.findMany({
        where: { invitationId, styleId },
        select: { variationId: true, status: true },
      });
      const submitted = new Set(
        existing
          .filter((q) => q.status === "SUBMITTED")
          .map((q) => q.variationId),
      );

      for (const row of nominatedVariations) {
        const target = row.variationId!;
        if (target === variationId) continue;
        if (submitted.has(target)) continue;

        await db.quote.upsert({
          where: {
            invitationId_styleId_variationKey: {
              invitationId,
              styleId,
              variationKey: variationKeyOf(target),
            },
          },
          create: {
            invitationId,
            styleId,
            vendorId: invitation.vendorId,
            variationId: target,
            variationKey: variationKeyOf(target),
            status: "DRAFT",
            values: (body.values ?? {}) as never,
            bucketTotals: (body.bucketTotals ?? {}) as never,
            fob: body.fob ?? null,
            dutyType: body.dutyType ?? null,
            ...termsFromValues(
              (body.values ?? {}) as Record<string, unknown>,
              body,
            ),
          },
          update: {
            status: "DRAFT",
            values: (body.values ?? {}) as never,
            bucketTotals: (body.bucketTotals ?? {}) as never,
            fob: body.fob ?? null,
            ...(body.dutyType !== undefined
              ? { dutyType: body.dutyType }
              : {}),
            ...termsFromValues(
              (body.values ?? {}) as Record<string, unknown>,
              body,
            ),
          },
        });
      }
    }

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
    // DISTINCT products against submitted QUOTES — one quote per product,
    // so both sides must be product-counts.
    //
    // Two defects fixed here. (1) `invitationStyle.count` counts ROWS, and
    // since nomination went per variation a vendor on 3 sizes has 3 rows for
    // one product: `total` tripled and the invitation could never read
    // SUBMITTED. (2) `submitted` had NO round filter — harmless while round
    // is always 1, but the moment a round 2 exists a round-1 submission
    // satisfies round-2 completion and the invitation flips to SUBMITTED
    // having received nothing. Flagged as trap 4 in the plan; fixed while
    // the first defect had this code open.
    const [rows, submitted] = await Promise.all([
      db.invitationStyle.findMany({
        where: { invitationId },
        select: { styleId: true },
      }),
      // DISTINCT PRODUCTS with a submitted quote.
      //
      // `count` would be wrong twice over now: a quote exists per VARIATION
      // (H8.5), so a vendor who submitted 3 sizes of one product would count
      // as 3; and the round filter is meaningless since rounds were replaced
      // by the status ladder. Both sides must be product-counts.
      db.quote.findMany({
        where: { invitationId, status: "SUBMITTED" },
        select: { styleId: true },
      }),
    ]);
    const total = new Set(rows.map((r) => r.styleId)).size;
    const submittedProducts = new Set(submitted.map((q) => q.styleId)).size;
    await db.invitation.update({
      where: { id: invitationId },
      data: {
        status:
          submittedProducts >= total
            ? "SUBMITTED"
            : submittedProducts > 0 || status === "DRAFT"
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

/** First row per styleId wins, preserving query order. */
function dedupeByStyle<T extends { styleId: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    if (seen.has(row.styleId)) continue;
    seen.add(row.styleId);
    out.push(row);
  }
  return out;
}
