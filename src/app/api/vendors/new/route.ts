import { db } from "@/lib/db";
import { badRequest, ok } from "@/lib/api";
import { cooRegion, countryIso } from "@/lib/parse";

/**
 * @openapi
 * /api/vendors/new:
 *   post:
 *     summary: Create a vendor with a temporary code
 *     description: >
 *       Build Doc §5.3. Captures name, country of origin and email, and
 *       generates a temp code — two letters of the name plus an incrementing
 *       number. A temp vendor stops being temp when onboarded through the
 *       existing vendor portal process.
 *     responses:
 *       200: { description: The created vendor }
 *       400: { description: Missing name or unrecognised country }
 */
export async function POST(request: Request) {
  const body = (await request.json()) as {
    name?: string;
    country?: string;
    email?: string;
  };

  const name = body.name?.trim();
  if (!name) return badRequest("A vendor name is required");

  const iso = countryIso(body.country);
  if (!iso) return badRequest("Pick a country of origin");

  const region = cooRegion(iso);
  if (!region) {
    return badRequest(`${body.country} is not in a known sourcing region`);
  }

  try {
    /**
     * Two letters of the name plus an incrementing number (Build Doc 5.3),
     * carried behind a TEMP- prefix.
     *
     * The prefix is on the CODE rather than beside it as a chip, because a chip
     * does not travel: the code appears in exports, in the vendor's own portal
     * and in any downstream list, and in all of those a bare `CD101` reads as a
     * real vendor code. The chip beside the name is then free to mean exactly
     * one thing — vendor type (3.7) — instead of two.
     */
    const prefix = name.replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase();
    const codePrefix = `TEMP-${prefix}`;
    const siblings = await db.vendor.findMany({
      where: { vendorCode: { startsWith: codePrefix }, isTemp: true },
      select: { vendorCode: true },
    });
    const next =
      siblings.reduce((max, v) => {
        const n = Number(v.vendorCode.slice(codePrefix.length));
        return Number.isFinite(n) && n > max ? n : max;
      }, 0) + 1;

    const vendor = await db.vendor.create({
      data: {
        vendorCode: `${codePrefix}${String(next).padStart(3, "0")}`,
        name,
        countryIso: iso,
        cooRegion: region,
        // New to the ecosystem by definition — this is what makes the $10M
        // spend cap apply rather than the $20M one.
        isNewToQuince: true,
        isTemp: true,
        email: body.email?.trim() || null,
      },
    });

    return ok({
      id: vendor.id,
      vendorCode: vendor.vendorCode,
      name: vendor.name,
      countryIso: vendor.countryIso,
      cooRegion: vendor.cooRegion,
      isNewToQuince: true,
      isTemp: true,
    });
  } catch (error) {
    console.error("[api/vendors/new]", error);
    return Response.json(
      { error: "server_error", message: String(error) },
      { status: 500 },
    );
  }
}
