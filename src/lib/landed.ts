import { blended, type Blend } from "@/domain/cost";
import { resolveLogistics, resolveTariff, type RateBook } from "@/lib/bestCost";

/**
 * The landed SUM, made visible (ux/14). Bid summary, Compare bids and the
 * style header all show FOB + tariff + logistics = landed, and current landed
 * built the same way from Baseline PCOGS — one implementation, so the three
 * screens can never disagree.
 */
export type Modes = { ocean: number; air: number; blend: number };


/** Tariff rate and per-unit logistics for one product x variant x COO. */
export function costParts(
  rates: RateBook,
  style: { styleNumber: string; htsCode: string | null },
  countryIso: string | null,
  size: string | null,
  blend: Blend,
): { tariffRate: number; logistics: Modes } {
  const l = resolveLogistics(rates, style.styleNumber, countryIso, size);
  return {
    tariffRate: resolveTariff(rates, style.htsCode, countryIso),
    logistics: { ocean: l.ocean, air: l.air, blend: blended(l.air, l.ocean, blend) },
  };
}

/**
 * Current landed = Baseline PCOGS x (1 + tariff) + logistics, per mode. Falls
 * back to the imported landed baseline when there is no PCOGS to build from.
 */
export function currentAt(
  parts: { tariffRate: number; logistics: Modes },
  pcogs: number,
  fallback: number,
  blend: Blend,
): Modes {
  if (!pcogs) return { ocean: fallback, air: fallback, blend: fallback };
  const base = pcogs * (1 + parts.tariffRate);
  const ocean = base + parts.logistics.ocean;
  const air = base + parts.logistics.air;
  return { ocean, air, blend: blended(air, ocean, blend) };
}
