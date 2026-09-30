import { db } from "@/lib/db";
import { badRequest, handle, notFound } from "@/lib/api";
import { serialise } from "../route";

/**
 * @openapi
 * /api/asks/{id}:
 *   patch:
 *     summary: Resolve, reopen, or reply to an Ask
 *     description: >
 *       ADDRESSED is automatic — the vendor changed the value. Whether they
 *       moved it FAR ENOUGH is a judgement, so RESOLVED and REOPENED are
 *       procurement's to set. Without this step "addressed" would silently mean
 *       "accepted", which it does not.
 *     responses:
 *       200: { description: The updated Ask }
 *       400: { description: Illegal transition }
 *       404: { description: No such Ask }
 *   delete:
 *     summary: Withdraw an Ask raised in error
 */
export function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const { id } = await params;
    const body = (await request.json()) as {
      status?: "RESOLVED" | "REOPENED";
      reply?: string | null;
    };

    const ask = await db.ask.findUnique({ where: { id } });
    if (!ask) return notFound(`Ask ${id}`);

    if (body.status && !["RESOLVED", "REOPENED"].includes(body.status)) {
      // OPEN and ADDRESSED are reached by the vendor's actions, never set here.
      return badRequest(
        `${body.status} is not a transition procurement makes — OPEN and ADDRESSED follow from the vendor's own edits`,
      );
    }

    const updated = await db.ask.update({
      where: { id },
      data: {
        ...(body.status ? { status: body.status } : {}),
        ...(body.reply !== undefined
          ? { reply: body.reply?.trim() || null }
          : {}),
      },
    });

    return serialise(updated);
  });
}

export function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const { id } = await params;
    const ask = await db.ask.findUnique({ where: { id }, select: { id: true } });
    if (!ask) return notFound(`Ask ${id}`);
    await db.ask.delete({ where: { id } });
    return { id, deleted: true };
  });
}
