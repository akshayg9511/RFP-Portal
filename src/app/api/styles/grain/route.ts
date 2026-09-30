import { db } from "@/lib/db";
import { badRequest, handle } from "@/lib/api";
import {
  allowedForAll,
  canTransition,
  type Grain,
  GRAINS,
} from "@/domain/grain";

/**
 * openapi:
 *   /api/styles/grain:
 *     patch:
 *       summary: Set the variation grain on one or many products
 *       description: >
 *         Style.variationLevel is the runtime source of truth for a product's
 *         bid grain. The ladder is one-way (STYLE -> COLOUR/SIZE -> SKU), so a
 *         request that would move a product up or sideways is refused for the
 *         WHOLE set rather than partially applied — a bulk action that
 *         silently skips some rows and reports success is worse than one that
 *         refuses.
 *       responses:
 *         200: { description: "{ updated, grain }" }
 *         400: { description: No styles, unknown grain, or an illegal move }
 */

type Body = { styleIds?: string[]; grain?: string };

export function PATCH(request: Request) {
  return handle(async () => {
    return patchGrain(request);
  });
}

async function patchGrain(request: Request) {
  const body = (await request.json()) as Body;
  const styleIds = body.styleIds ?? [];
  const grain = body.grain as Grain | undefined;

  if (!styleIds.length) return badRequest("Select at least one product");
  if (!grain || !GRAINS.includes(grain)) {
    return badRequest(`Grain must be one of ${GRAINS.join(", ")}`);
  }

  const styles = await db.style.findMany({
    where: { id: { in: styleIds } },
    select: { id: true, styleNumber: true, variationLevel: true },
  });

  if (styles.length !== styleIds.length) {
    return badRequest("A product in the selection no longer exists");
  }

  // Refuse the whole set, and name the offenders. The alternative — apply
  // what is legal and skip the rest — leaves the user believing every
  // selected product changed.
  const illegal = styles.filter(
    (s) =>
      s.variationLevel !== grain &&
      !canTransition(s.variationLevel as Grain, grain),
  );
  if (illegal.length) {
    const names = illegal.map((s) => s.styleNumber).join(", ");
    return badRequest(
      `Cannot set ${grain} on ${names} — a grain only moves down the ladder ` +
        `(style to colour or size, then to SKU), never back up or sideways.`,
    );
  }

  // Already there is a no-op, not an error: a bulk "push this department to
  // SKU" legitimately includes products that arrived earlier.
  const toChange = styles.filter((s) => s.variationLevel !== grain);

  if (toChange.length) {
    await db.style.updateMany({
      where: { id: { in: toChange.map((s) => s.id) } },
      data: { variationLevel: grain },
    });
  }

  return {
    updated: toChange.length,
    unchanged: styles.length - toChange.length,
    grain,
  };
}

/**
 * openapi:
 *   /api/styles/grain:
 *     get:
 *       summary: Which grains a selection may legally move to
 *       responses:
 *         200: { description: "{ allowed: Grain[] }" }
 */
export function GET(request: Request) {
  const ids = new URL(request.url).searchParams.get("styleIds");
  const styleIds = ids ? ids.split(",").filter(Boolean) : [];

  return handle(async () => {
    if (!styleIds.length) return { allowed: [] as Grain[] };
    const styles = await db.style.findMany({
      where: { id: { in: styleIds } },
      select: { variationLevel: true },
    });
    return {
      allowed: allowedForAll(styles.map((s) => s.variationLevel as Grain)),
    };
  });
}
