import { db } from "@/lib/db";
import { badRequest, handle, num } from "@/lib/api";

/**
 * @openapi
 * /api/asks:
 *   get:
 *     summary: Asks for an invitation, or for one product within it
 *     parameters:
 *       - name: invitationId
 *         in: query
 *         required: true
 *         schema: { type: string }
 *       - name: styleId
 *         in: query
 *         schema: { type: string }
 *     responses:
 *       200: { description: Asks, newest first }
 *   post:
 *     summary: Raise an Ask
 *     description: >
 *       Anchored to a bucket or a line item. The anchor is what makes an Ask
 *       self-addressing: when the vendor changes that value the Ask marks
 *       itself ADDRESSED with before/after, so nobody has to chase (Build
 *       Doc 7.3).
 *     responses:
 *       201: { description: The Ask }
 *       400: { description: Missing anchor target }
 */
export function GET(request: Request) {
  const url = new URL(request.url);
  const invitationId = url.searchParams.get("invitationId");
  const styleId = url.searchParams.get("styleId");

  return handle(async () => {
    if (!invitationId) return badRequest("invitationId is required");

    const asks = await db.ask.findMany({
      where: {
        invitationId,
        ...(styleId ? { styleId } : {}),
      },
      orderBy: { createdAt: "desc" },
    });

    return asks.map(serialise);
  });
}

export function POST(request: Request) {
  return handle(async () => {
    const body = (await request.json()) as {
      invitationId?: string;
      anchor?: string;
      styleId?: string | null;
      bucket?: string | null;
      fieldPath?: string | null;
      type?: string;
      body?: string | null;
      targetPctLo?: number | null;
      targetPctHi?: number | null;
      mandatory?: boolean;
    };

    if (!body.invitationId) return badRequest("invitationId is required");
    const anchor = body.anchor ?? "PRODUCT_BUCKET";

    // An anchor with nothing to point at cannot auto-address, which is the
    // whole point of an Ask — so it is rejected rather than stored inert.
    if (anchor === "PRODUCT_BUCKET" && !body.bucket) {
      return badRequest("A bucket Ask needs a bucket");
    }
    if (anchor === "PRODUCT_FIELD" && !body.fieldPath) {
      return badRequest("A field Ask needs a fieldPath");
    }
    if (
      (anchor === "PRODUCT_BUCKET" || anchor === "PRODUCT_FIELD") &&
      !body.styleId
    ) {
      return badRequest("A product-anchored Ask needs a styleId");
    }

    const invitation = await db.invitation.findUnique({
      where: { id: body.invitationId },
      select: { id: true, currentRound: true },
    });
    if (!invitation) return badRequest("No such invitation");

    /**
     * Capture the value being asked about, NOW. This is the reference the
     * auto-address compares against — without it the Ask has nothing to have
     * moved away from, and domain/asks deliberately refuses to claim a
     * response in that case.
     */
    let valueBefore: string | null = null;
    if (body.styleId) {
      const quote = await db.quote.findFirst({
        where: {
          invitationId: invitation.id,
          styleId: body.styleId,
          round: invitation.currentRound,
        },
        select: { bucketTotals: true, values: true },
      });
      if (quote) {
        if (anchor === "PRODUCT_BUCKET" && body.bucket) {
          const totals = (quote.bucketTotals ?? {}) as Record<string, number>;
          const t = totals[body.bucket];
          if (t !== undefined) valueBefore = String(Math.round(t * 10_000) / 10_000);
        } else if (anchor === "PRODUCT_FIELD" && body.fieldPath) {
          const vals = (quote.values ?? {}) as Record<string, unknown>;
          const raw = vals[body.fieldPath];
          if (raw !== undefined && raw !== null && raw !== "") {
            const n = Number(raw);
            valueBefore = Number.isFinite(n)
              ? String(Math.round(n * 10_000) / 10_000)
              : String(raw);
          }
        }
      }
    }

    const ask = await db.ask.create({
      data: {
        invitationId: invitation.id,
        anchor,
        styleId: body.styleId ?? null,
        bucket: body.bucket ?? null,
        fieldPath: body.fieldPath ?? null,
        type: body.type ?? "REDUCE",
        body: body.body?.trim() || null,
        targetPctLo: body.targetPctLo ?? null,
        targetPctHi: body.targetPctHi ?? null,
        mandatory: body.mandatory ?? false,
        valueBefore,
        round: invitation.currentRound,
        createdBy: "Procurement",
      },
    });

    return serialise(ask);
  });
}

type AskRow = {
  id: string;
  invitationId: string;
  anchor: string;
  styleId: string | null;
  bucket: string | null;
  fieldPath: string | null;
  type: string;
  body: string | null;
  targetPctLo: unknown;
  targetPctHi: unknown;
  status: string;
  mandatory: boolean;
  valueBefore: string | null;
  valueAfter: string | null;
  reply: string | null;
  round: number;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Decimals as numbers, dates as ISO — no Prisma types reach the client. */
export function serialise(a: AskRow) {
  return {
    id: a.id,
    invitationId: a.invitationId,
    anchor: a.anchor,
    styleId: a.styleId,
    bucket: a.bucket,
    fieldPath: a.fieldPath,
    type: a.type,
    body: a.body,
    targetPctLo: num(a.targetPctLo as never),
    targetPctHi: num(a.targetPctHi as never),
    status: a.status,
    mandatory: a.mandatory,
    valueBefore: a.valueBefore,
    valueAfter: a.valueAfter,
    reply: a.reply,
    round: a.round,
    createdBy: a.createdBy,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}
