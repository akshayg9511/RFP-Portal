import type { Prisma } from "@prisma/client";
import { num } from "@/lib/api";
import { computeCost, type Blend, type CostResult } from "@/domain/cost";

/**
 * The ONE place Best Cost is computed on the read path.
 *
 * Award Summary, the Playground and Wave Insights all resolve through here.
 * Two of them computing Best Cost differently — ranking on FOB in one place and
 * landed cost in another — is precisely the class of defect that produced the
 * Wave 1 -$37,038 error, so there is deliberately no second implementation.
 *
 * `domain/cost.ts` owns the arithmetic and stays framework-free. This module
 * owns the LOOKUPS: which tariff rate, which logistics rate, and how a vendor's
 * DDP quote becomes a number comparable with the Quince blend.
 */

/** A quote's six DDP columns plus the FOB the chain runs on. */
export type QuoteCostFields = {
  fob: Prisma.Decimal | number | null;
  ddpWest: Prisma.Decimal | number | null;
  ddpCentral: Prisma.Decimal | number | null;
  ddpEast: Prisma.Decimal | number | null;
  ddpWestAir: Prisma.Decimal | number | null;
  ddpCentralAir: Prisma.Decimal | number | null;
  ddpEastAir: Prisma.Decimal | number | null;
};

/**
 * Everything the resolver needs, loaded once per request rather than per quote.
 * 82 styles times several bids each is otherwise an N+1 on two tables.
 */
export type RateBook = {
  /** `${htsCode}|${countryIso}` -> rate as a fraction. */
  tariff: Map<string, number>;
  /** `${styleNumber}|${size ?? ""}` -> ocean/air. */
  logistics: Map<string, { ocean: number; air: number }>;
  /** COO-median fallback, so a style with no row still lands a real number. */
  cooMedian: Map<string, { ocean: number; air: number }>;
  blend: Blend;
};

/**
 * DDP is quoted per MODE (air / ocean); the three US destinations are a second
 * axis WITHIN each mode. So a full DDP quote is six numbers, not three.
 *
 * THE COLUMNS HOLD THE VENDOR'S FEE, not a delivered price — fixed 5 Oct.
 * The vendor form asks for "the additional charge for DDP into LAX" (the real
 * Radnik template's wording), and the delivered DDP price is FOB + that fee:
 * Akshay, "DDP is always FOB plus their logistics cost". The columns used to
 * be read as delivered totals while the form wrote fees into them, so a $0.42
 * fee read as a $0.42 delivered price and Best Cost picked it as the cheapest
 * bid. Reading it as a fee also means each VARIANT's DDP total follows its own
 * FOB, since the fee is a per-product term.
 *
 * We take the HIGHEST destination fee in each mode. Deliberate and
 * conservative: DDP then wins on Best Cost only if it beats the Quince blend
 * even at its most expensive destination. Surfaced as "DDP (highest dest.)".
 *
 * Returns null for a mode unless at least one destination carries a fee, and
 * null for both when there is no FOB to add it to; `computeCost` then leaves
 * ddpBlend null and the basis stays QUINCE_BLEND. Both modes are required for
 * DDP to count at all (decided 5 Oct — a one-mode quote is not DDP-eligible).
 */
export function ddpByMode(quote: QuoteCostFields): {
  ddpOcean: number | null;
  ddpAir: number | null;
} {
  const fob = num(quote.fob);
  const highest = (...values: (Prisma.Decimal | number | null)[]) => {
    const present = values
      .map((v) => num(v))
      .filter((v): v is number => v !== null);
    return present.length && fob !== null ? fob + Math.max(...present) : null;
  };

  return {
    // The unsuffixed trio is the OCEAN set (see the schema comment on Quote).
    ddpOcean: highest(quote.ddpWest, quote.ddpCentral, quote.ddpEast),
    ddpAir: highest(quote.ddpWestAir, quote.ddpCentralAir, quote.ddpEastAir),
  };
}

/**
 * Logistics is keyed on styleNumber + size, with blank-size rows acting as the
 * style-level rate. Exact match first, then style level, then the COO median.
 * Which one answered is not currently surfaced; the seed report already states
 * coverage, and a missing rate cannot silently become zero here.
 */
export function resolveLogistics(
  rates: RateBook,
  styleNumber: string,
  countryIso: string | null,
  size?: string | null,
): { ocean: number; air: number } {
  if (size) {
    const exact = rates.logistics.get(`${styleNumber}|${size}`);
    if (exact) return exact;
  }
  const styleLevel = rates.logistics.get(`${styleNumber}|`);
  if (styleLevel) return styleLevel;

  const median = countryIso ? rates.cooMedian.get(countryIso) : undefined;
  return median ?? { ocean: 0, air: 0 };
}

export function resolveTariff(
  rates: RateBook,
  htsCode: string | null,
  countryIso: string | null,
): number {
  if (!htsCode || !countryIso) return 0;
  return rates.tariff.get(`${htsCode}|${countryIso}`) ?? 0;
}

/**
 * FOB -> tariff -> logistics -> landed -> 70/30 blend -> Best Cost, for one
 * bid. Returns null when the quote carries no FOB, rather than treating a
 * missing price as free.
 */
export function resolveBestCost(
  quote: QuoteCostFields,
  style: { styleNumber: string; htsCode: string | null },
  vendor: { countryIso: string | null },
  rates: RateBook,
  size?: string | null,
): CostResult | null {
  const fob = num(quote.fob);
  if (fob === null) return null;

  const { ocean, air } = resolveLogistics(
    rates,
    style.styleNumber,
    vendor.countryIso,
    size,
  );
  const { ddpOcean, ddpAir } = ddpByMode(quote);

  return computeCost({
    fob,
    tariffRate: resolveTariff(rates, style.htsCode, vendor.countryIso),
    logisticsOcean: ocean,
    logisticsAir: air,
    ddpOcean,
    ddpAir,
    blend: rates.blend,
  });
}
