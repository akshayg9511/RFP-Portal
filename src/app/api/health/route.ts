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
    const [styles, vendors, styleSets, templates, configs] = await Promise.all([
      db.style.count(),
      db.vendor.count(),
      db.styleSet.count(),
      db.template.count(),
      db.config.count(),
    ]);

    return NextResponse.json({
      ok: true,
      database: "connected",
      counts: { styles, vendors, styleSets, templates, configs },
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
