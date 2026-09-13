import { db } from "@/lib/db";
import { badRequest, handle, ok } from "@/lib/api";

/**
 * @openapi
 * /api/rfps:
 *   get:
 *     summary: RFPs in the wave
 *     responses:
 *       200: { description: RFPs, newest first }
 *   post:
 *     summary: Create one RFP per template group
 *     description: >
 *       Creates RFPs in DRAFT. Vendor nomination and issue are separate steps —
 *       an RFP with no vendors is a valid intermediate state.
 *     responses:
 *       201: { description: The created RFPs }
 *       400: { description: Nothing to create }
 */
export function GET() {
  return handle(async () => {
    const rfps = await db.rfp.findMany({
      include: {
        template: { select: { name: true } },
        wave: { select: { name: true } },
        _count: { select: { styles: true, invitations: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return rfps.map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      templateName: r.template.name,
      waveName: r.wave.name,
      dueDate: r.dueDate,
      currentRound: r.currentRound,
      styleCount: r._count.styles,
      vendorCount: r._count.invitations,
      instructions: r.instructions,
      createdAt: r.createdAt,
    }));
  });
}

type CreateBody = {
  groups?: {
    templateId: string;
    name: string;
    instructions?: string;
    styleIds: string[];
  }[];
  comment?: string;
};

export async function POST(request: Request) {
  const body = (await request.json()) as CreateBody;
  const groups = body.groups ?? [];

  if (!groups.length) return badRequest("Nothing to create");
  for (const group of groups) {
    if (!group.name?.trim()) {
      return badRequest("Every RFP needs a name before it can be created");
    }
    if (!group.styleIds?.length) {
      return badRequest(`${group.name} has no products`);
    }
  }

  try {
    // One wave in the prototype; RFPs attach to the open one.
    const wave =
      (await db.wave.findFirst({ orderBy: { createdAt: "desc" } })) ??
      (await db.wave.create({ data: { name: "Wave 2 — FY26" } }));

    const created = [];
    for (const group of groups) {
      const rfp = await db.rfp.create({
        data: {
          waveId: wave.id,
          templateId: group.templateId,
          name: group.name.trim(),
          instructions: group.instructions?.trim() || null,
          comment: body.comment?.trim() || null,
          status: "DRAFT",
          dueDate: wave.dueDate,
          styles: {
            create: group.styleIds.map((styleId) => ({ styleId })),
          },
        },
        include: { _count: { select: { styles: true } } },
      });

      await db.activityLog.create({
        data: {
          entity: "RFP",
          entityId: rfp.id,
          action: "CREATED",
          actorSide: "QUINCE",
          detail: { styleCount: rfp._count.styles } as never,
        },
      });

      created.push({
        id: rfp.id,
        name: rfp.name,
        styleCount: rfp._count.styles,
      });
    }

    return ok({ created });
  } catch (error) {
    console.error("[api/rfps POST]", error);
    return Response.json(
      { error: "server_error", message: String(error) },
      { status: 500 },
    );
  }
}
