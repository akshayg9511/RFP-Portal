/**
 * The shape of `GET /api/styles/[id]/bids`, shared by the two product pages.
 *
 * One fetch serves both: comparing and allocating read the same bids, so
 * duplicating the type would let them drift.
 */

export type Bid = {
  quoteId: string;
  invitationId: string;
  vendorId: string;
  vendorName: string;
  vendorCode: string;
  cooRegion: string | null;
  countryIso: string | null;
  isNewToQuince: boolean;
  isCurrentSupplier: boolean;
  dutyType: string | null;
  fob: number | null;
  bucketTotals: Record<string, number>;
  bucketFlags: { bucket: string; flag: "ABOVE" | "IN_LINE" | "BELOW" }[];
  /** Template-defined line inputs. Keys vary by template — never assumed. */
  values: Record<string, unknown>;
  maxVolumeCapacity: number | null;
  productionLeadTime: number | null;
  moq: number | null;
  landedOcean: number | null;
  landedAir: number | null;
  quinceBlend: number | null;
  ddpBlend: number | null;
  bestCost: number;
  bestCostBasis: "QUINCE_BLEND" | "DDP_BLEND";
  /** Which variation this bid is for — a row is never shown without one. */
  variationId: string | null;
  variationLabel: string;
};

/**
 * One line item as the template defines it. Shape mirrors the seeded
 * `Template.definition.sections[].lines[]` — keys, labels and units come from
 * the template, never from a map in the screen, because Ponte and Lauren Home
 * genuinely differ and a hardcoded map would show blanks on one of them.
 */
export type TemplateLine = {
  key: string;
  label: string;
  help?: string | null;
  unit?: string | null;
  inputType?: string | null;
  derived?: boolean;
};

export type TemplateSection = {
  key: string;
  label: string;
  lines: TemplateLine[];
  totalKey?: string | null;
};

export type TemplateDefinition = {
  sections?: TemplateSection[];
  additionalInformation?: TemplateLine[] | null;
};

export type ProductBids = {
  style: {
    id: string;
    styleNumber: string;
    name: string;
    division: string | null;
    department: string | null;
    subDepartment: string | null;
    heroImage: string | null;
    images: string[];
    colourways: { id: string; name: string; images: string[] }[];
    variationLevel: string | null;
    /** The SELECTED variation's volume and baselines (N2). */
    planUnits: number | null;
    baselineFob: number | null;
    baselineLanded: number | null;
  };
  /**
   * Every award group of the product, for the header dropdown. One entry,
   * variationId null, for a STYLE-grained product.
   */
  variations: {
    variationId: string | null;
    label: string;
    planUnits: number;
    /** What is SAVED for this variation — 100 means done. */
    allocatedPct: number;
  }[];
  selectedVariationId: string | null;
  bids: Bid[];
  cleanSheet: { buckets: Record<string, number>; fob: number } | null;
  allocation: {
    vendorId: string;
    awardPct: number;
    status: string;
    comment: string | null;
  }[];
  template: { name: string; definition: TemplateDefinition } | null;
  strategies: {
    key: string;
    label: string;
    rule: string;
    split: Record<string, number>;
    unavailable: string | null;
  }[];
};

/** Bucket order and labels — the five that both real templates roll up to. */
export const BUCKET_ORDER = [
  "BASE_MATERIALS",
  "TRIM_HARDWARE",
  "PACKAGING",
  "CRAFTING",
  "OVERHEAD_SGA_PROFIT",
];

export const BUCKET_LABEL: Record<string, string> = {
  BASE_MATERIALS: "Materials",
  TRIM_HARDWARE: "Trim & hardware",
  PACKAGING: "Packaging",
  CRAFTING: "Crafting",
  OVERHEAD_SGA_PROFIT: "Overhead, SG&A & profit",
};

export const BASIS_LABEL: Record<string, string> = {
  QUINCE_BLEND: "Quince freight",
  DDP_BLEND: "DDP (highest dest.)",
};

/** Incumbent / Existing / New — derived, never stored (Build Doc 3.7). */
export function vendorType(bid: {
  isCurrentSupplier: boolean;
  isNewToQuince: boolean;
}): "Incumbent" | "New" | "Existing" {
  if (bid.isCurrentSupplier) return "Incumbent";
  return bid.isNewToQuince ? "New" : "Existing";
}

/**
 * The lines behind ONE bucket, split into the costs and the inputs.
 *
 * Why two groups: a bucket's lines are not all money. BASE_MATERIALS carries
 * six USD lines (grey fabric/m, dyeing, printing…) and eight inputs
 * (consumption in metres, wastage %, fabric width, source country). Showing
 * them as one list is what made the old flat drill-down unreadable.
 *
 * The costs answer "what makes this bucket expensive"; the inputs answer
 * "why" — a vendor whose Materials is high because consumption is 2.05m, not
 * because fabric costs more. That is the whole point of the expand.
 *
 * `derived` lines are dropped: they are the template's own subtotals, and
 * showing a total inside the expansion of a total reads as double counting.
 */
export function bucketLines(
  definition: TemplateDefinition | null | undefined,
  bucket: string,
): { costs: TemplateLine[]; inputs: TemplateLine[] } {
  const section = definition?.sections?.find((s) => s.key === bucket);
  if (!section) return { costs: [], inputs: [] };

  const costs: TemplateLine[] = [];
  const inputs: TemplateLine[] = [];

  for (const line of section.lines ?? []) {
    if (line.derived) continue;
    // The template marks money two ways depending on which file it came from:
    // `unit: "USD"` and `inputType: "currency"`. Accept either.
    const isMoney = line.unit === "USD" || line.inputType === "currency";
    (isMoney ? costs : inputs).push(line);
  }

  return { costs, inputs };
}

/** A line's value on one bid, or null when the vendor left it blank. */
export function lineValue(
  bid: { values: Record<string, unknown> },
  key: string,
): number | string | null {
  const raw = bid.values?.[key];
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    const n = Number(raw);
    // A string that is not a number is a real answer ("Ponte knit",
    // "Vietnam"), so it is returned as text rather than coerced to NaN.
    return raw.trim() === "" ? null : Number.isFinite(n) ? n : raw;
  }
  return null;
}
