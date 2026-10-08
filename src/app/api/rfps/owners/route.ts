import { db } from "@/lib/db";
import { handle } from "@/lib/api";
import { ownerList } from "@/lib/owners";

/**
 * @openapi
 * /api/rfps/owners:
 *   get:
 *     summary: People who can own an RFP
 *     description: >
 *       The pick-lists for the RFP form's Sourcing partners and GMs.
 *       PROTOTYPE CONTRACT — the backend team replaces this with the real
 *       people directory; the response shape is what the UI depends on.
 *       Today it reads Config key "rfp.owners" ({ sourcingPartners, gms })
 *       when set, and otherwise every name already used on an RFP plus a
 *       small seeded list.
 *     responses:
 *       200: { description: "{ sourcingPartners: string[], gms: string[] }" }
 */

const SEEDED = {
  sourcingPartners: ["Akshay Goel", "Dana Kowalski", "Priya Raman", "Tony Alvarez"],
  gms: ["Jackie Chen", "Marcus Webb"],
};

export function GET() {
  return handle(async () => {
    const config = await db.config.findUnique({ where: { key: "rfp.owners" } });
    const configured = (config?.value ?? null) as {
      sourcingPartners?: string[];
      gms?: string[];
    } | null;

    const rfps = await db.rfp.findMany({
      select: { sourcingPartner: true, sourcingPartners: true, gm: true, gms: true },
    });

    const partners = new Set(configured?.sourcingPartners ?? SEEDED.sourcingPartners);
    const gms = new Set(configured?.gms ?? SEEDED.gms);
    for (const r of rfps) {
      ownerList(r.sourcingPartners, r.sourcingPartner).forEach((p) => partners.add(p));
      ownerList(r.gms, r.gm).forEach((g) => gms.add(g));
    }

    const sorted = (s: Set<string>) => [...s].sort((a, b) => a.localeCompare(b));
    return { sourcingPartners: sorted(partners), gms: sorted(gms) };
  });
}
