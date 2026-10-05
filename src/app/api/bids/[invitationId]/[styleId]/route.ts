import { db } from "@/lib/db";
import { badRequest, notFound, ok } from "@/lib/api";
import {
  canTransition,
  quinceLabel,
  transitionsFrom,
  vendorLabel,
  type Actor,
  type BidStatus,
} from "@/domain/bidStatus";

/**
 * @openapi
 * /api/bids/{invitationId}/{styleId}:
 *   get:
 *     summary: One vendor x product — its ladder position and its thread
 *     description: >
 *       The status with BOTH label sets, the transitions legal from here,
 *       and the whole comment thread. Status changes are themselves comments
 *       (statusChange set), so the thread is the chronology — there is no
 *       separate audit rail to reconcile with it.
 *   patch:
 *     summary: Move the status, with a note, or post a comment
 */

/** Absent means never issued, which reads as the floor of the ladder. */
const FLOOR: BidStatus = "INVITED";

async function loadBid(invitationId: string, styleId: string) {
  return db.productBid.findFirst({
    where: { invitationId, styleId },
    include: { comments: { orderBy: { createdAt: "asc" } } },
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ invitationId: string; styleId: string }> },
) {
  const { invitationId, styleId } = await params;
  /**
   * WHOSE MOVES TO OFFER.
   *
   * The ladder is two-sided: Quince clears and requests, the vendor submits
   * and withdraws. Hardcoding QUINCE here offered the VENDOR's own panel
   * Quince's moves — including accepting their own bid. There is no RBAC
   * (T6) so this is not a security boundary, but it IS a correctness one:
   * the control must not offer a move its actor cannot legally make.
   */
  const side: Actor =
    new URL(request.url).searchParams.get("side") === "VENDOR"
      ? "VENDOR"
      : "QUINCE";

  try {
    const invitation = await db.invitation.findUnique({
      where: { id: invitationId },
      select: {
        id: true,
        vendor: { select: { id: true, name: true } },
        styles: { where: { styleId }, select: { styleId: true } },
      },
    });
    if (!invitation) return notFound(`Invitation ${invitationId}`);
    if (!invitation.styles.length) {
      return notFound("That product is not in this invitation");
    }

    const bid = await loadBid(invitationId, styleId);
    const status = (bid?.status ?? FLOOR) as BidStatus;

    return ok({
      invitationId,
      styleId,
      vendor: invitation.vendor,
      status,
      /**
       * ONE stored value, TWO label sets. Both are returned so neither side
       * derives its own wording — that is how they drift apart.
       */
      quinceLabel: quinceLabel(status),
      vendorLabel: vendorLabel(status),
      statusNote: bid?.statusNote ?? null,
      statusChangedAt: bid?.statusChangedAt ?? null,
      /** What Quince may do from here. The UI offers only these. */
      side,
      transitions: transitionsFrom(status, side).map((t) => ({
        to: t.to,
        /**
         * Each side reads its OWN wording in the picker. Offering the vendor
         * "Full costing in review" — Quince's internal phrasing — described
         * the consequence from the wrong seat; theirs reads "Full costing
         * submitted — with Quince", which is the whole point of two label
         * sets.
         */
        label: side === "VENDOR" ? vendorLabel(t.to) : quinceLabel(t.to),
        /** What the OTHER side will read, shown before the move is taken. */
        vendorWillSee: vendorLabel(t.to),
      })),
      comments: (bid?.comments ?? []).map((c) => ({
        id: c.id,
        authorSide: c.authorSide,
        authorName: c.authorName,
        body: c.body,
        statusChange: c.statusChange,
        createdAt: c.createdAt,
      })),
    });
  } catch (error) {
    console.error(error);
    return badRequest("Could not load that bid");
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ invitationId: string; styleId: string }> },
) {
  const { invitationId, styleId } = await params;
  const body = (await request.json()) as {
    /** Omit to post a plain comment without moving the status. */
    to?: BidStatus;
    /** The one-line note to the vendor. Required on a transition (H1). */
    note?: string | null;
    authorSide?: Actor;
    authorName?: string | null;
  };

  try {
    const invitation = await db.invitation.findUnique({
      where: { id: invitationId },
      select: { id: true, styles: { where: { styleId }, select: { styleId: true } } },
    });
    if (!invitation) return notFound(`Invitation ${invitationId}`);
    if (!invitation.styles.length) {
      return notFound("That product is not in this invitation");
    }

    const existing = await loadBid(invitationId, styleId);
    const from = (existing?.status ?? FLOOR) as BidStatus;
    const authorSide: Actor = body.authorSide ?? "QUINCE";

    /**
     * A COMMENT WITH NO TRANSITION is legal and common — it is how the two
     * sides talk between moves.
     */
    if (!body.to) {
      if (!body.note?.trim()) return badRequest("A comment needs a body");
      const bid =
        existing ??
        (await db.productBid.create({
          data: { invitationId, styleId, status: from },
        }));
      await db.bidComment.create({
        data: {
          productBidId: bid.id,
          authorSide,
          authorName: body.authorName ?? null,
          body: body.note.trim(),
        },
      });
      return ok({ status: from, posted: true });
    }

    /**
     * THE LADDER IS ENFORCED HERE, NOT ONLY IN THE UI.
     *
     * The control offers legal moves only, but a stale client must not be
     * able to post an illegal one — the status drives which template the
     * vendor is asked for and whether they may type at all, so an illegal
     * jump would put the bid in a state no screen is built for.
     */
    if (!canTransition(from, body.to, authorSide)) {
      return badRequest(
        `${quinceLabel(from)} cannot move to ${quinceLabel(body.to)}` +
          (authorSide === "QUINCE" ? "" : ` as ${authorSide.toLowerCase()}`),
      );
    }

    /**
     * EVERY QUINCE TRANSITION CARRIES A NOTE (H1), and it posts into the
     * thread so there is ONE chronology rather than a status rail beside a
     * conversation. The vendor is told what changed and why in the same
     * place they reply.
     */
    const note = body.note?.trim() || null;
    if (authorSide === "QUINCE" && !note) {
      return badRequest("Tell the vendor why — a one-line note is required");
    }

    const bid = await db.productBid.upsert({
      where: existing
        ? { id: existing.id }
        : { invitationId_styleId: { invitationId, styleId } },
      create: {
        invitationId,
        styleId,
        status: body.to,
        statusNote: note,
        statusChangedAt: new Date(),
      },
      update: {
        status: body.to,
        statusNote: note,
        statusChangedAt: new Date(),
      },
    });

    await db.bidComment.create({
      data: {
        productBidId: bid.id,
        authorSide,
        authorName: body.authorName ?? null,
        // A transition with no note is only reachable vendor-side, where the
        // move itself is the message.
        body: note ?? `Moved to ${quinceLabel(body.to)}`,
        statusChange: body.to,
      },
    });

    return ok({
      status: bid.status,
      quinceLabel: quinceLabel(body.to),
      vendorLabel: vendorLabel(body.to),
    });
  } catch (error) {
    console.error(error);
    return badRequest("Could not update that bid");
  }
}
