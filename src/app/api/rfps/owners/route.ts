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
 *       200: { description: "{ sourcingPartners: string[], gms: string[], procurementOwners: string[] }" }
 */

const SEEDED = {
  sourcingPartners: ["Akshay Goel", "Dana Kowalski", "Priya Raman", "Tony Alvarez"],
  gms: ["Jackie Chen", "Marcus Webb"],
  procurementOwners: ["Elena Petrova", "Rahul Mehta"],
};

export function GET() {
  return handle(async () => {
    const config = await db.config.findUnique({ where: { key: "rfp.owners" } });
    const configured = (config?.value ?? null) as {
      sourcingPartners?: string[];
      gms?: string[];
      procurementOwners?: string[];
    } | null;

    const rfps = await db.rfp.findMany({
      select: {
        sourcingPartner: true,
        sourcingPartners: true,
        gm: true,
        gms: true,
        procurementOwners: true,
      },
    });

    const partners = new Set(configured?.sourcingPartners ?? SEEDED.sourcingPartners);
    const gms = new Set(configured?.gms ?? SEEDED.gms);
    const procurement = new Set(configured?.procurementOwners ?? SEEDED.procurementOwners);
    for (const r of rfps) {
      ownerList(r.sourcingPartners, r.sourcingPartner).forEach((p) => partners.add(p));
      ownerList(r.gms, r.gm).forEach((g) => gms.add(g));
      ownerList(r.procurementOwners, null).forEach((o) => procurement.add(o));
    }

    const sorted = (s: Set<string>) => [...s].sort((a, b) => a.localeCompare(b));
    return {
      sourcingPartners: sorted(partners),
      gms: sorted(gms),
      procurementOwners: sorted(procurement),
    };
  });
}
