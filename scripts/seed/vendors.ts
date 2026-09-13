import type { PrismaClient } from "@prisma/client";
import { cooRegion, countryIso, money, str } from "../../src/lib/parse";
import { pick, readSheet, SOURCES, step, type rng } from "./lib";

/**
 * Vendor master.
 *
 * Real vendors come from the curated files; country is resolved from the Wave 1
 * tracker where possible and assigned otherwise. Additional vendors are
 * generated so all five COO regions have real presence — in the source data
 * Americas and EMEA exist as a single vendor each, which would leave two
 * guardrail rows permanently empty.
 *
 * Vendor TYPE is never stored (Build Doc 3.7): isNewToQuince plus the
 * CurrentSupplier relation derives Incumbent / Existing / New.
 */

export type VendorSeed = {
  id: string;
  vendorCode: string;
  name: string;
  countryIso: string;
  cooRegion: string;
  isNewToQuince: boolean;
};

/** Resolved from the Wave 1 `Finance` sheet by vendor code. */
const COUNTRY_OVERRIDES: Record<string, string> = {
  FGGCL005: "KH",
  ZXTCL005: "CN",
  RHPL004: "IN",
  ZJSCL007: "CN",
  // No country in any source. Assigned — made-up data is acceptable, and
  // dropping them would orphan styles for no benefit.
  YNHTC005: "CN",
  YZICL005: "CN",
};

/** Generated vendors, chosen to populate the thin regions. */
const GENERATED = [
  { name: "Pacific Loom Textiles", iso: "VN" },
  { name: "Mekong Apparel Works", iso: "VN" },
  { name: "Phnom Penh Garment Co", iso: "KH" },
  { name: "Java Home Textiles", iso: "ID" },
  { name: "Bangkok Weaving House", iso: "TH" },
  { name: "Coimbatore Mills", iso: "IN" },
  { name: "Tirupur Knit Exports", iso: "IN" },
  { name: "Dhaka Linen Partners", iso: "BD" },
  { name: "Colombo Textile Group", iso: "LK" },
  { name: "Suzhou Silk Manufacturing", iso: "CN" },
  { name: "Ningbo Home Goods", iso: "CN" },
  { name: "Shandong Cotton Works", iso: "CN" },
  // Americas — one real Mexico vendor is not enough for the floor to read.
  { name: "Monterrey Apparel Group", iso: "MX" },
  { name: "Guadalajara Textiles", iso: "MX" },
  { name: "Lima Cotton Collective", iso: "PE" },
  { name: "Guatemala City Sewing", iso: "GT" },
  // EMEA — likewise, one Jordan vendor.
  { name: "Amman Textile Industries", iso: "JO" },
  { name: "Izmir Weaving Co", iso: "TR" },
  { name: "Porto Linen Atelier", iso: "PT" },
  { name: "Casablanca Garment Works", iso: "MA" },
] as const;

export async function seedVendors(
  db: PrismaClient,
  next: ReturnType<typeof rng>,
): Promise<{
  vendors: VendorSeed[];
  currentSuppliers: Map<string, { code: string; fob: number | null }[]>;
}> {
  // Real vendors, and which styles they currently supply.
  const real = new Map<string, { name: string | null; iso: string | null }>();
  const currentSuppliers = new Map<
    string,
    { code: string; fob: number | null }[]
  >();

  for (const file of [SOURCES.bedding, SOURCES.bottoms]) {
    for (const row of await readSheet(file)) {
      const code = str(row["Default Vendor Code"]);
      const styleNumber = str(row["Style Number"]);
      if (!code || !styleNumber) continue;

      if (!real.has(code)) {
        real.set(code, { name: str(row["Vendor Name"]), iso: null });
      }

      const existing = currentSuppliers.get(styleNumber) ?? [];
      if (!existing.some((s) => s.code === code)) {
        existing.push({ code, fob: money(row["Product Cost"]) });
        currentSuppliers.set(styleNumber, existing);
      }
    }
  }

  // Country from the tracker, then the override table.
  const landed = await readSheet(SOURCES.wave1, "Current Landed", 2);
  const byCode = new Map<string, string>();
  for (const row of landed) {
    const code = str(row["Vendor Code"]);
    const iso = countryIso(row["COO"]);
    if (code && iso && !byCode.has(code)) byCode.set(code, iso);
  }

  const vendors: VendorSeed[] = [];

  for (const [code, info] of real) {
    const iso = byCode.get(code) ?? COUNTRY_OVERRIDES[code] ?? "CN";
    const region = cooRegion(iso);
    if (!region) continue;

    const created = await db.vendor.create({
      data: {
        vendorCode: code,
        name: info.name ?? `Vendor ${code}`,
        countryIso: iso,
        cooRegion: region,
        // Current suppliers are inside the ecosystem by definition.
        isNewToQuince: false,
        email: `${code.toLowerCase()}@example-vendor.test`,
      },
    });
    vendors.push({
      id: created.id,
      vendorCode: code,
      name: created.name,
      countryIso: iso,
      cooRegion: region,
      isNewToQuince: false,
    });
  }

  step(`${vendors.length} vendors from source`);

  // Generated vendors. Roughly a third are new to Quince, so all three derived
  // types appear and the $10M / $20M spend caps both have subjects.
  let n = 1;
  for (const g of GENERATED) {
    const region = cooRegion(g.iso);
    if (!region) continue;
    const isNew = next() < 0.35;
    const code = `${g.name.slice(0, 2).toUpperCase()}${String(n++).padStart(3, "0")}`;

    const created = await db.vendor.create({
      data: {
        vendorCode: code,
        name: g.name,
        countryIso: g.iso,
        cooRegion: region,
        isNewToQuince: isNew,
        email: `${code.toLowerCase()}@example-vendor.test`,
      },
    });
    vendors.push({
      id: created.id,
      vendorCode: code,
      name: g.name,
      countryIso: g.iso,
      cooRegion: region,
      isNewToQuince: isNew,
    });
  }

  step(`${GENERATED.length} vendors generated for COO spread`);
  return { vendors, currentSuppliers };
}
