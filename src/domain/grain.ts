/**
 * VARIATION GRAIN — which axis a product is bid, compared and awarded on.
 *
 * Pure functions, no framework imports. This is the single resolver for a
 * question every screen asks: given this product, what are its variation
 * groups?
 *
 * `Style.variationLevel` is the source of truth (D1). `Template.productAxis`
 * only seeds it and is never read at runtime — two live sources for one fact
 * is how you end up quoting at one grain and awarding at another, which makes
 * the 100% rule unsatisfiable in a way nobody can diagnose from the UI.
 */

export type Grain = "STYLE" | "COLOUR" | "SIZE" | "SKU";

export const GRAINS: Grain[] = ["STYLE", "COLOUR", "SIZE", "SKU"];

/**
 * The grain ladder is ONE-WAY: down only, never up, never sideways.
 *
 *         STYLE
 *         ├──→ COLOUR ──→ SKU
 *         └──→ SIZE   ──→ SKU
 *
 * Going up or sideways would orphan whatever has already been selected, bid
 * or awarded at the finer grain — a COLOUR→SIZE move cannot say what happens
 * to a bid placed against "Ivory".
 *
 * The config screen offers only what this returns, and illegal targets are
 * ABSENT rather than disabled: a disabled option invites "why can't I?" and
 * needs explanatory copy on every row.
 */
export function allowedTransitions(current: Grain): Grain[] {
  switch (current) {
    case "STYLE":
      return ["COLOUR", "SIZE", "SKU"];
    case "COLOUR":
      return ["SKU"];
    case "SIZE":
      return ["SKU"];
    case "SKU":
      return [];
  }
}

export function canTransition(from: Grain, to: Grain): boolean {
  return allowedTransitions(from).includes(to);
}

/**
 * Applying one grain to MANY products at once (the config screen's bulk
 * action) is only legal where it is legal for every product in the set —
 * otherwise a single illegal row would silently not change while the rest
 * did, and the screen would report success.
 */
export function allowedForAll(currents: Grain[]): Grain[] {
  if (!currents.length) return [];
  return GRAINS.filter((target) =>
    currents.every((from) => from === target || canTransition(from, target)),
  );
}

/** A variation as the grain functions need it. */
export type VariationLike = {
  id: string;
  size: string | null;
  sizeSortOrder: number | null;
  colour: string | null;
};

/**
 * The bid groups for a product at its grain.
 *
 * `STYLE` returns exactly ONE group covering every variation. That single
 * branch is what lets every caller run the grouped path unconditionally —
 * the style-level case is the DEGENERATE case, not a special case, which is
 * the whole defence against the 100%-at-the-wrong-scope bug.
 */
export type GrainGroup = {
  /** Stable key within the style. "@STYLE" for a style-grained product. */
  key: string;
  /** What the user reads: "Queen", "Ivory", "Queen / Ivory". */
  label: string;
  /** Every variation rolled into this group. */
  variationIds: string[];
};

export function grainGroups(
  grain: Grain,
  variations: VariationLike[],
): GrainGroup[] {
  if (grain === "STYLE" || !variations.length) {
    return [
      {
        key: "@STYLE",
        label: "All variations",
        variationIds: variations.map((v) => v.id),
      },
    ];
  }

  const keyOf = (v: VariationLike): string => {
    if (grain === "COLOUR") return v.colour ?? "—";
    if (grain === "SIZE") return v.size ?? "—";
    return `${v.colour ?? "—"} / ${v.size ?? "—"}`;
  };

  // Insertion order follows the caller's sort, so a size-grained product
  // reads Twin → Full → King rather than alphabetically.
  const groups = new Map<string, GrainGroup>();
  for (const v of variations) {
    const key = keyOf(v);
    const existing = groups.get(key);
    if (existing) existing.variationIds.push(v.id);
    else groups.set(key, { key, label: key, variationIds: [v.id] });
  }
  return [...groups.values()];
}

/**
 * The sentinel that stands in for "the whole product" in a unique key.
 *
 * MySQL treats every NULL as DISTINCT in a unique index, so a nullable
 * variationId alone enforces nothing for whole-product rows — the same
 * style could join one style set without limit, and the same vendor could
 * hold two style-level quotes for one round. Collapsing the NULLs to a
 * constant is what makes the constraint bite.
 *
 * Written by the app rather than a MySQL generated column: Prisma flags a
 * generated expression as drift on every subsequent `migrate dev`, and this
 * prototype has migrations that must keep replaying from empty.
 */
export const WHOLE_STYLE_KEY = "@STYLE";

export function variationKeyOf(variationId: string | null | undefined): string {
  return variationId ?? WHOLE_STYLE_KEY;
}

/** Does this product have anything to expand? Drives the chevron. */
export function isExpandable(grain: Grain): boolean {
  return grain !== "STYLE";
}
