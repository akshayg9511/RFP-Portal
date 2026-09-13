import { PrismaClient } from "@prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { rng, step } from "./lib";
import { readPlanUnits, seedConfig, seedLogistics, seedTariff } from "./lookups";
import { seedStyles } from "./styles";
import { seedTemplates } from "./templates";
import { seedVendors } from "./vendors";
import { seedBids } from "./bids";

/**
 * Seed the prototype.
 *
 *   npm run seed
 *
 * Re-runnable: truncates in FK-safe order first, so it never half-loads.
 * Deterministic: one fixed RNG seed, so every run produces identical numbers.
 */

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env.");
  process.exit(1);
}

const db = new PrismaClient({ adapter: new PrismaMariaDb(url) });
const next = rng();

async function clear() {
  // Children first — the order is the point. TRUNCATE cannot be used here:
  // it ignores FK order, and SET FOREIGN_KEY_CHECKS=0 does not survive a
  // pooled connection, so each statement could land on a different session.
  for (const table of [
    "ActivityLog",
    "Award",
    "Ask",
    "Quote",
    "InvitationStyle",
    "Invitation",
    "RfpStyle",
    "Rfp",
    "Wave",
    "Template",
    "StyleImage",
    "Colourway",
    "Variation",
    "CleanSheet",
    "CurrentSupplier",
    "StyleSetMember",
    "StyleSet",
    "Style",
    "Vendor",
    "TariffRate",
    "LogisticsRate",
    "Config",
  ]) {
    await db.$executeRawUnsafe(`DELETE FROM \`${table}\``);
  }
  step("cleared");
}

async function main() {
  const started = Date.now();
  console.log("\nSeeding Procura\n");

  await clear();

  // Lookups first — styles need plan units, bids need tariff and logistics.
  const planUnits = await readPlanUnits();
  await seedTariff(db);
  const { cooMedian } = await seedLogistics(db);
  await seedConfig(db, cooMedian);

  const styles = await seedStyles(db, planUnits);
  const { vendors, currentSuppliers } = await seedVendors(db, next);

  // Current suppliers — who makes a style today. A style-level fact, and
  // never to be confused with vendor type (Build Doc 3.7).
  const styleIds = new Map<string, string>();
  const styleHts = new Map<string, string | null>();
  for (const row of await db.style.findMany({
    select: { id: true, styleNumber: true, htsCode: true },
  })) {
    styleIds.set(row.styleNumber, row.id);
    styleHts.set(row.styleNumber, row.htsCode);
  }
  const vendorIds = new Map(vendors.map((v) => [v.vendorCode, v.id]));

  let supplierLinks = 0;
  for (const [styleNumber, suppliers] of currentSuppliers) {
    const styleId = styleIds.get(styleNumber);
    if (!styleId) continue;
    for (const s of suppliers) {
      const vendorId = vendorIds.get(s.code);
      if (!vendorId) continue;
      await db.currentSupplier.create({
        data: { styleId, vendorId, currentFob: s.fob },
      });
      supplierLinks++;
    }
  }
  step(`${supplierLinks} current-supplier links`);

  // Style sets — the selection scaffolding, and what splits into RFPs.
  const bySubDept = new Map<string, string[]>();
  for (const s of styles) {
    const list = bySubDept.get(s.subDepartment) ?? [];
    list.push(s.styleNumber);
    bySubDept.set(s.subDepartment, list);
  }

  let setCount = 0;
  for (const [subDept, members] of bySubDept) {
    if (members.length < 2) continue;
    await db.styleSet.create({
      data: {
        name: subDept,
        description: `All ${members.length} styles in ${subDept}.`,
        lastUsedIn: "Wave 1",
        members: {
          create: members.map((m) => ({ styleId: styleIds.get(m)! })),
        },
      },
    });
    setCount++;
  }

  // A cross-category set, so "one selection splits into two RFPs" has a subject.
  const crossMembers = [
    ...styles.filter((s) => s.division === "Home").slice(0, 12),
    ...styles.filter((s) => s.division !== "Home").slice(0, 8),
  ];
  await db.styleSet.create({
    data: {
      name: "FY26 Cost Reduction Priority",
      description:
        "High-spend styles across bedding and bottoms. Spans two templates.",
      members: {
        create: crossMembers.map((m) => ({ styleId: styleIds.get(m.styleNumber)! })),
      },
    },
  });
  setCount++;
  step(`${setCount} style sets`);

  const templates = await seedTemplates(db);

  // Lookup closures for the bid generator.
  const tariffRows = await db.tariffRate.findMany();
  const tariffMap = new Map(
    tariffRows.map((r) => [`${r.htsCode}|${r.countryIso}`, Number(r.rate)]),
  );
  const tariffLookup = (hts: string | null, iso: string) =>
    (hts ? tariffMap.get(`${hts}|${iso}`) : undefined) ?? 0.15;

  const logisticsRows = await db.logisticsRate.findMany();
  const byStyle = new Map<string, { ocean: number; air: number }[]>();
  for (const r of logisticsRows) {
    if (r.ocean === null || r.air === null) continue;
    const list = byStyle.get(r.styleNumber) ?? [];
    list.push({ ocean: Number(r.ocean), air: Number(r.air) });
    byStyle.set(r.styleNumber, list);
  }
  const logisticsLookup = (styleNumber: string, iso: string) => {
    const rows = byStyle.get(styleNumber);
    if (rows?.length) {
      return {
        ocean: avg(rows.map((r) => r.ocean)),
        air: avg(rows.map((r) => r.air)),
      };
    }
    // No rate for this style — fall back to the COO median.
    return cooMedian.get(iso) ?? { ocean: 1.0, air: 5.0 };
  };

  const result = await seedBids(
    db,
    next,
    styles,
    vendors,
    templates,
    tariffLookup,
    logisticsLookup,
    styleIds,
    styleHts,
  );

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\nDone in ${seconds}s.`);
  console.log(
    `  ${styles.length} styles · ${vendors.length} vendors · ` +
      `${result.allocated} styles allocated · China ${(result.chinaShare * 100).toFixed(1)}%\n`,
  );
}

function avg(values: number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}

main()
  .catch((error) => {
    console.error("\nSeed failed:\n", error);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
