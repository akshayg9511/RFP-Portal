import { db } from "@/lib/db";
import { handle } from "@/lib/api";

/**
 * @openapi
 * /api/config:
 *   get:
 *     summary: Tuning constants — band cutoffs, blend, guardrail thresholds
 *     description: >
 *       Held in the database rather than in code so they retune against a real
 *       bid distribution without a release (Build Doc 8.3, 11.8).
 *     responses:
 *       200: { description: Every config entry, keyed }
 */
export function GET() {
  return handle(async () => {
    const entries = await db.config.findMany({ orderBy: { key: "asc" } });
    return Object.fromEntries(entries.map((e) => [e.key, e.value]));
  });
}
