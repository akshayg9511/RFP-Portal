import { db } from "@/lib/db";
import { badRequest, handle, notFound, ok } from "@/lib/api";
import { splitTotalsHundred } from "@/domain/strategies";

/**
 * Named allocation strategies for one product.
 *
 * These are CANDIDATES, not the committed split — Award owns that. A product
 * can carry several named strategies so they can be compared against each
 * other and against the four built-in rules.
 *
 * Nothing derived is stored. Savings, blended cost and the region mix are
 * recomputed in the browser by running the saved split through
 * `domain/award.allocate()` — the same function the Allocate tab uses, so a
 * card can never disagree with the split it fills.
 */

/**
 * @openapi
 * /api/styles/{id}/strategies:
 *   get:
 *     summary: Named allocation strategies saved on this product
 *     responses:
 *       200: { description: Strategies, newest first }
 *   post:
 *     summary: Save the current split under a name
 *     description: >
 *       Requires a split totalling exactly 100% — a strategy is a candidate for
 *       a real award, and PUT /award refuses anything else, so storing a
 *       partial split would create something that can never be applied.
 *     responses:
 *       201: { description: Created }
 *       400: { description: Empty name, duplicate name, or split not 100% }
 *       404: { description: No such style }
 */
export function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const { id } = await params;

    const rows = await db.awardStrategy.findMany({
      where: { styleId: id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        comment: true,
        split: true,
        createdAt: true,
      },
    });

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      comment: r.comment,
      split: (r.split ?? {}) as Record<string, number>,
      createdAt: r.createdAt.toISOString(),
    }));
  });
}

type Body = {
  name?: string;
  comment?: string | null;
  split?: Record<string, number>;
};

export function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const { id } = await params;
    const body = (await request.json()) as Body;

    const style = await db.style.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!style) return notFound(`Style ${id}`);

    const name = (body.name ?? "").trim();
    if (!name) return badRequest("A strategy needs a name.");
    if (name.length > 120) {
      return badRequest("Keep the name under 120 characters.");
    }

    const split = body.split ?? {};
    if (!splitTotalsHundred(split)) {
      const total = Object.values(split).reduce((s, v) => s + v, 0);
      return badRequest(
        `A strategy must total exactly 100%. This split totals ${Math.round(total * 100) / 100}%.`,
      );
    }

    // Every vendor in the split must actually have a submitted bid on this
    // style. Without this a stale client could name a split referencing a
    // vendor who was never invited, and applying it later would fail at PUT
    // with a confusing message about a vendor nobody recognises.
    const bidders = await db.quote.findMany({
      where: { styleId: id, status: "SUBMITTED" },
      select: { vendorId: true },
    });
    const allowed = new Set(bidders.map((b) => b.vendorId));
    const unknown = Object.keys(split).filter((v) => !allowed.has(v));
    if (unknown.length) {
      return badRequest(
        `${unknown.length} vendor(s) in this split have no submitted bid on this product.`,
      );
    }

    const clash = await db.awardStrategy.findFirst({
      where: { styleId: id, name },
      select: { id: true },
    });
    if (clash) {
      return badRequest(`A strategy called "${name}" already exists here.`);
    }

    const created = await db.awardStrategy.create({
      data: {
        styleId: id,
        name,
        comment: body.comment?.trim() || null,
        split,
      },
      select: {
        id: true,
        name: true,
        comment: true,
        split: true,
        createdAt: true,
      },
    });

    return ok({
      id: created.id,
      name: created.name,
      comment: created.comment,
      split: (created.split ?? {}) as Record<string, number>,
      createdAt: created.createdAt.toISOString(),
    });
  });
}
