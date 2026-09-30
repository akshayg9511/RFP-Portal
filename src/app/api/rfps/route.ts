import { db } from "@/lib/db";
import { badRequest, handle, num, ok } from "@/lib/api";

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
        // The list carried only two counts, so it could not say whether an RFP
        // was on track — the reason to open one.
        styles: { select: { style: { select: { id: true, baselineFob: true } } } },
        invitations: {
          select: {
            vendorId: true,
            quotes: {
              where: { status: "SUBMITTED" },
              select: { styleId: true, fob: true },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return rfps.map((r) => {
      const responded = r.invitations.filter((i) => i.quotes.length > 0).length;
      const bidCount = r.invitations.reduce((sum, i) => sum + i.quotes.length, 0);

      const bidStyleIds = new Set(
        r.invitations.flatMap((i) => i.quotes.map((q) => q.styleId)),
      );

      /**
       * Lowest bid against baseline, across the products that have bids. The
       * headline reason to read an RFP once vendors reply — and FOB against
       * FOB, never landed, which is the error class this build keeps hitting.
       */
      let baselineOfBid = 0;
      let lowestOfBid = 0;
      for (const rs of r.styles) {
        const base = num(rs.style.baselineFob);
        if (!base || !bidStyleIds.has(rs.style.id)) continue;
        const fobs = r.invitations
          .flatMap((i) => i.quotes.filter((q) => q.styleId === rs.style.id))
          .map((q) => num(q.fob))
          .filter((f): f is number => f !== null);
        if (!fobs.length) continue;
        baselineOfBid += base;
        lowestOfBid += Math.min(...fobs);
      }

      return {
        id: r.id,
        name: r.name,
        status: r.status,
        templateName: r.template.name,
        waveName: r.wave.name,
        dueDate: r.dueDate,
        currentRound: r.currentRound,
        styleCount: r._count.styles,
        vendorCount: r._count.invitations,
        respondedCount: responded,
        bidCount,
        stylesWithBids: bidStyleIds.size,
        lowestVsBaseline: baselineOfBid
          ? (lowestOfBid - baselineOfBid) / baselineOfBid
          : null,
        instructions: r.instructions,
        createdAt: r.createdAt,
      };
    });
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
