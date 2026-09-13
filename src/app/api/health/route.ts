import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * GET /api/health
 *
 * Proves the stack end to end: route handler -> Prisma -> MySQL. Used by the
 * F1 landing page so a green tick means the whole chain is live, not just that
 * Next rendered.
 *
 * @openapi
 * /api/health:
 *   get:
 *     summary: Database connectivity and seeded row counts
 *     responses:
 *       200:
 *         description: Connected, with per-table counts
 *       503:
 *         description: Database unreachable
 */
export async function GET() {
  try {
    const [styles, images, vendors, styleSets, templates, quotes, awards] =
      await Promise.all([
        db.style.count(),
        db.styleImage.count(),
        db.vendor.count(),
        db.styleSet.count(),
        db.template.count(),
        db.quote.count(),
        db.award.count(),
      ]);

    return NextResponse.json({
      ok: true,
      database: "connected",
      counts: { styles, images, vendors, styleSets, templates, quotes, awards },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        database: "unreachable",
        hint: "Run: docker compose up -d",
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 503 },
    );
  }
}
