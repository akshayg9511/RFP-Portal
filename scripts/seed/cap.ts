/**
 * DEMO VARIATION CAP.
 *
 * The real catalogue gives some styles 40 SKUs (U-BEDD-33 = 8 colours x 5
 * sizes). Expanding one of those in the product catalog would push 40 rows
 * into the page, which reads as unusable rather than granular. The business
 * only needs to SEE that variations work, so the seed keeps 4-5 per product.
 *
 * WHY sizeSortOrder AND NOT plan units. The obvious key — "keep the biggest
 * sellers" — is unavailable: the seed divides a style's plan units EVENLY
 * across its SKUs, and the source data is keyed by style number with no
 * per-SKU volume at all. Ranking by units would be an arbitrary tie-break
 * dressed up as commercial relevance. sizeSortOrder is real, so the kept
 * sizes form a contiguous run a buyer recognises (Twin, Full, Full/Queen,
 * King) instead of a scattered subset.
 *
 * Colours are kept by IMAGE COUNT so the gallery stays rich — a colourway
 * with one photograph makes the carousel look broken.
 *
 * This is DEMO SHAPING, not business logic. It belongs in the seed and
 * nowhere else.
 */

/**
 * How many BID GROUPS to keep — not how many values per axis.
 *
 * Capping each axis independently gives 5 sizes x 5 colours = 25 variations,
 * which is not what "4-5 variations per product" means. The grain decides
 * which axis is the group, so the OTHER axis is squeezed to fit.
 */
export const CAP = 5;

type Row = Record<string, unknown>;

export type CapAccessors = {
  size: (row: Row) => string | null;
  sizeSortOrder: (row: Row) => number | null;
  colour: (row: Row) => string | null;
  imageCount: (row: Row) => number;
};

/** Which axis carries the bid groups, so the other one gets squeezed. */
export type CapGrain = "STYLE" | "COLOUR" | "SIZE" | "SKU";

/**
 * Pick which SKU rows survive.
 *
 * Both axes are capped, because the product is browsable at any grain — a
 * SIZE-grained style still shows its colourways in the gallery, and a
 * 1-size x 8-colour product would still render 8 rows at COLOUR grain.
 */
export function capSkuRows(
  rows: Row[],
  get: CapAccessors,
  grain: CapGrain = "SIZE",
): Row[] {
  if (rows.length <= CAP) return rows;

  // How many values each axis may keep, so the PRODUCT lands at ~CAP
  // variations rather than CAP-squared. The grain axis keeps its spread; the
  // other collapses to one, except at SKU grain where the product IS the
  // cross-product and both share the budget.
  const sizeBudget =
    grain === "SIZE" ? CAP : grain === "SKU" ? Math.ceil(Math.sqrt(CAP)) : 1;
  const colourBudget =
    grain === "COLOUR" ? CAP : grain === "SKU" ? Math.floor(Math.sqrt(CAP)) : 1;

  // Sizes: the first CAP in natural size order. Nulls sort last so a real
  // size is never dropped in favour of a blank.
  const sizes = [...new Set(rows.map((r) => get.size(r) ?? "\u0000"))];
  const orderOf = new Map<string, number>();
  for (const row of rows) {
    const key = get.size(row) ?? "\u0000";
    const order = get.sizeSortOrder(row);
    const current = orderOf.get(key);
    // Lowest sort order wins, so a size appearing twice keeps its real rung.
    if (order !== null && (current === undefined || order < current)) {
      orderOf.set(key, order);
    }
  }
  const keptSizes = new Set(
    sizes
      .sort((a, b) => {
        if (a === "\u0000") return 1;
        if (b === "\u0000") return -1;
        const oa = orderOf.get(a) ?? Number.MAX_SAFE_INTEGER;
        const ob = orderOf.get(b) ?? Number.MAX_SAFE_INTEGER;
        return oa === ob ? a.localeCompare(b) : oa - ob;
      })
      .slice(0, sizeBudget),
  );

  // Colours: the CAP richest by image count, so the carousel has material.
  const imagesByColour = new Map<string, number>();
  for (const row of rows) {
    const key = get.colour(row) ?? "\u0000";
    imagesByColour.set(
      key,
      (imagesByColour.get(key) ?? 0) + get.imageCount(row),
    );
  }
  const keptColours = new Set(
    [...imagesByColour.entries()]
      .sort((a, b) => (b[1] === a[1] ? a[0].localeCompare(b[0]) : b[1] - a[1]))
      .slice(0, colourBudget)
      .map(([colour]) => colour),
  );

  const kept = rows.filter(
    (r) =>
      keptSizes.has(get.size(r) ?? "\u0000") &&
      keptColours.has(get.colour(r) ?? "\u0000"),
  );

  // Never return nothing. If the two axes happen not to intersect, fall back
  // to the first CAP rows rather than seeding a style with no variations —
  // a style with zero variations breaks the gallery and the size list.
  return kept.length ? kept : rows.slice(0, CAP);
}
