import { db } from "@/lib/db";
import { variationKeyOf } from "@/domain/grain";
import { submitAdvancesTo, type BidStatus } from "@/domain/bidStatus";
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

    /**
     * The ladder position for this vendor x product. It decides WHICH
     * template the form asks for — light up to INITIAL_CLEARED, full after —
     * and whether the vendor may type at all. domain/bidStatus.ts owns both
     * answers; the route just carries the stored value.
     */
    const productBid = await db.productBid.findFirst({
      where: { invitationId, styleId },
      select: { status: true, statusNote: true, statusChangedAt: true },
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
      // No `round`: rounds were replaced by the status ladder (H1), and the
      // form read this nowhere. `bidStatus` below is what drives the depth
      // of the template the vendor is asked for.
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
      /**
       * ONE stored value, and the client renders the VENDOR label set from
       * it. Absent means never issued, which reads as INVITED — the floor of
       * the ladder, so a missing row is the degenerate case, not an error.
       */
      bidStatus: productBid?.status ?? "INVITED",
      bidStatusNote: productBid?.statusNote ?? null,
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
            /**
             * The six DDP fees — three US destinations x two modes. The
             * unsuffixed trio is OCEAN; see the schema comment. These are a
             * PER-PRODUCT declaration (Build Doc 3.6) so the form shows one
             * block and the PUT fans the values across every variant row.
             */
            ddpWest: num(quote.ddpWest),
            ddpCentral: num(quote.ddpCentral),
            ddpEast: num(quote.ddpEast),
            ddpWestAir: num(quote.ddpWestAir),
            ddpCentralAir: num(quote.ddpCentralAir),
            ddpEastAir: num(quote.ddpEastAir),
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
    /**
     * The six DDP fees — three US destinations x two modes. The unsuffixed
     * trio is OCEAN, matching the schema.
     *
     * DDP is declared PER PRODUCT (Build Doc 3.6), but Quote is keyed per
     * variation, so these are FANNED across every variant row below. The
     * form shows one block, so the copies cannot visibly disagree.
     */
    ddp?: {
      west?: number | null;
      central?: number | null;
      east?: number | null;
      westAir?: number | null;
      centralAir?: number | null;
      eastAir?: number | null;
    };
  };

  try {
    const invitation = await db.invitation.findUnique({
      where: { id: invitationId },
      select: { id: true, vendorId: true, vendor: { select: { email: true } } },
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

    /**
     * The DDP columns, mapped from the request's one block.
     *
     * Returns {} when the caller did not send `ddp` at all, so a save that
     * is not about DDP leaves the stored fees alone — the same reasoning as
     * dutyType below, and for the same reason: these decide whether a bid is
     * DDP at all, and nulling them silently changes Best Cost.
     */
    const ddpColumns =
      body.ddp === undefined
        ? {}
        : {
            ddpWest: body.ddp.west ?? null,
            ddpCentral: body.ddp.central ?? null,
            ddpEast: body.ddp.east ?? null,
            ddpWestAir: body.ddp.westAir ?? null,
            ddpCentralAir: body.ddp.centralAir ?? null,
            ddpEastAir: body.ddp.eastAir ?? null,
          };

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
        ...ddpColumns,
        ...termsFromValues((body.values ?? {}) as Record<string, unknown>, body),
        submittedAt: status === "SUBMITTED" ? new Date() : null,
      },
      update: {
        status,
        /**
         * ONLY WRITE WHAT THE CALLER SENT.
         *
         * These were written unconditionally, so a save that was not ABOUT
         * the breakdown — a DDP-only save, say — wrote `{}` over the values
         * and nulled the FOB of an already-submitted variant. Found by
         * saving a DDP block and watching a $14.49 Twin become NULL.
         *
         * This is the same rule dutyType has carried since 1.6d, for the
         * same reason: a partial payload must not be read as "delete the
         * rest".
         */
        ...(body.values !== undefined
          ? { values: body.values as never }
          : {}),
        ...(body.bucketTotals !== undefined
          ? { bucketTotals: body.bucketTotals as never }
          : {}),
        ...(body.fob !== undefined ? { fob: body.fob } : {}),
        // dutyType is only overwritten when the caller actually supplies it —
        // it decides whether a bid is DDP, and nulling it changes Best Cost.
        ...(body.dutyType !== undefined ? { dutyType: body.dutyType } : {}),
        ...ddpColumns,
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
     * DDP FANS ACROSS THE PRODUCT.
     *
     * DDP is declared once per product (Build Doc 3.6) but Quote is keyed per
     * variation, so one declaration has to reach every variant row or the
     * read path sees a product that is DDP for Twin and not for King.
     * lib/bestCost.ts takes the HIGHEST destination per mode, so a partial
     * fan-out would not merely be untidy — it would change Best Cost for
     * some sizes and not others.
     *
     * Unlike Apply-to-all this DOES touch submitted rows, and deliberately:
     * the fees are not that variant's committed price, they are a term of
     * trade for the whole product. Nothing about the variant's own numbers
     * (values, bucketTotals, fob, status) is written here.
     */
    if (body.ddp !== undefined || body.dutyType !== undefined) {
      await db.quote.updateMany({
        where: { invitationId, styleId, NOT: { variationKey } },
        data: {
          ...ddpColumns,
          ...(body.dutyType !== undefined ? { dutyType: body.dutyType } : {}),
        },
      });
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

    /**
     * SUBMITTING ADVANCES THE LADDER.
     *
     * The quote and the bid status were moving independently, so five
     * SUBMITTED quotes could sit under a bid still reading
     * CHANGES_REQUESTED: the vendor's screen said "Your turn" after they had
     * finished, and Quince was never told the work had come back.
     *
     * domain/bidStatus.ts owns where it goes (`submitAdvancesTo`), and the
     * move posts into the thread like any other so the chronology stays
     * whole. Idempotent: a second submit finds the bid already in review and
     * `submitAdvancesTo` returns null for it.
     */
    if (status === "SUBMITTED") {
      const bid = await db.productBid.findFirst({
        where: { invitationId, styleId },
        select: { id: true, status: true },
      });
      const from = (bid?.status ?? "INVITED") as BidStatus;
      const to = submitAdvancesTo(from);

      if (to) {
        const row = bid
          ? await db.productBid.update({
              where: { id: bid.id },
              data: { status: to, statusChangedAt: new Date() },
            })
          : await db.productBid.create({
              data: { invitationId, styleId, status: to },
            });

        await db.bidComment.create({
          data: {
            productBidId: row.id,
            authorSide: "VENDOR",
            authorEmail: invitation.vendor.email ?? null,
            body:
              variationId === null
                ? "Submitted this quote."
                : "Submitted a quote for one variation.",
            statusChange: to,
            statusFrom: from,
            kind: "UPDATE",
          },
        });
      }
    }

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
      // The COUNT, not the rows. Returning `submitted` (the array) rendered
      // as "[object Object],[object Object] of 1 products done" in the
      // vendor's own success message. submittedProducts is the de-duplicated
      // product count computed above — a quote exists per VARIATION now, so
      // the raw row count would also have been wrong.
      submittedCount: submittedProducts,
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
