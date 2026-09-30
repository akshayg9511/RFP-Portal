/**
 * DEMO GRAIN MATRIX.
 *
 * `Style.variationLevel` is the runtime source of truth for a product's bid
 * grain (D1). The seed's job is only to give every product a sensible
 * STARTING value so the config screen opens populated and editable rather
 * than empty — after that, the screen owns it.
 *
 * Defaults follow the category: bedding varies by size, apparel does not.
 * The overrides below exist so the business sees COLOUR, SIZE and SKU grain
 * side by side in one demo, which is the thing they asked to see.
 */

export type SeedGrain = "STYLE" | "COLOUR" | "SIZE" | "SKU";

/**
 * Per-product overrides, by style number.
 *
 * Cotton/Twill at COLOUR because Akshay's steer was "apparel is style, but a
 * few Cotton/Twill at colour level" — and 3 colours reads better than
 * Ponte's 2.
 *
 * U-BEDD-22 at SKU (7 colours x 2 sizes) shows the most granular case.
 * U-BEDD-33 is DELIBERATELY NOT the SKU example despite being the richest
 * product: 8 colours x 5 sizes would put 40 groups on one product and make
 * the grid look unusable. Do not "fix" this.
 */
export const DEMO_GRAIN: Record<string, SeedGrain> = {
  "W-PNT-61": "COLOUR",
  "W-PNT-62": "COLOUR",
  "U-BEDD-22": "SKU",
};

/** Apparel quotes at style level; bedding at size. */
const DIVISION_DEFAULT: Record<string, SeedGrain> = {
  Womens: "STYLE",
};

export function grainFor(
  styleNumber: string,
  derived: SeedGrain,
  division?: string | null,
): SeedGrain {
  const override = DEMO_GRAIN[styleNumber];
  if (override) return override;
  if (division && DIVISION_DEFAULT[division]) {
    return DIVISION_DEFAULT[division];
  }
  return derived;
}
