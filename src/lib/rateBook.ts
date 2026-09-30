import { db } from "@/lib/db";
import { DEFAULT_BLEND } from "@/domain/cost";
import type { RateBook } from "@/lib/bestCost";

/**
 * The database half of the cost chain, kept apart from `bestCost.ts` so the
 * resolver itself stays pure and testable without a database. Import this from
 * route handlers only.
 */

/**
 * Loads every rate once. Call at the top of a route handler and pass the result
 * down — the tables are small (hundreds of rows) and this keeps the per-bid
 * path pure arithmetic.
 */
export async function loadRateBook(): Promise<RateBook> {
  const [tariffRows, logisticsRows, configRows] = await Promise.all([
    db.tariffRate.findMany(),
    db.logisticsRate.findMany(),
    db.config.findMany({
      where: { key: { in: ["blend.air", "blend.ocean", "logistics.cooMedian"] } },
    }),
  ]);

  const config = new Map(configRows.map((c) => [c.key, c.value]));

  // The blend is a wave constant and lives in Config, never hardcoded — it is
  // one of the tuning values the Build Doc names explicitly (11.4, 8.3).
  const air = typeof config.get("blend.air") === "number"
    ? (config.get("blend.air") as number)
    : DEFAULT_BLEND.air;
  const ocean = typeof config.get("blend.ocean") === "number"
    ? (config.get("blend.ocean") as number)
    : DEFAULT_BLEND.ocean;

  const medianRaw = (config.get("logistics.cooMedian") ?? {}) as Record<
    string,
    { ocean: number; air: number }
  >;

  return {
    tariff: new Map(
      tariffRows.map((t) => [
        `${t.htsCode}|${t.countryIso}`,
        Number(t.rate),
      ]),
    ),
    logistics: new Map(
      logisticsRows.map((l) => [
        `${l.styleNumber}|${l.size ?? ""}`,
        { ocean: Number(l.ocean ?? 0), air: Number(l.air ?? 0) },
      ]),
    ),
    cooMedian: new Map(Object.entries(medianRaw)),
    blend: { air, ocean },
  };
}
