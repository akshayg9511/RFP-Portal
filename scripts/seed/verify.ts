import { PrismaClient } from "@prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";

/**
 * The F2 gate. Asserts what must be true before any screen is built on this
 * data, and prints a report. Exits non-zero on failure, so a half-loaded seed
 * cannot pass silently.
 *
 *   npm run seed:verify
 */

const db = new PrismaClient({
  adapter: new PrismaMariaDb(process.env.DATABASE_URL as string),
});

let failures = 0;

function check(label: string, ok: boolean, detail: string) {
  const mark = ok ? "PASS" : "FAIL";
  if (!ok) failures++;
  console.log(`  ${mark}  ${label.padEnd(46)} ${detail}`);
}

async function main() {
  console.log("\nF2 verification\n");

  // 1 — styles
  const styles = await db.style.count();
  const withUnits = await db.style.count({ where: { planUnits: { gt: 0 } } });
  const withFob = await db.style.count({ where: { baselineFob: { gt: 0 } } });
  check("82 styles seeded", styles === 82, `${styles}`);
  check("every style has plan units", withUnits === styles, `${withUnits}/${styles}`);
  check("every style has a baseline FOB", withFob === styles, `${withFob}/${styles}`);

  // 2 — images
  const images = await db.styleImage.count();
  const imageGroups = await db.styleImage.groupBy({
    by: ["styleId"],
    _count: { _all: true },
  });
  const counts = imageGroups.map((g) => g._count._all).sort((a, b) => a - b);
  const medianImages = counts[Math.floor(counts.length / 2)] ?? 0;
  check(
    "every style has at least one image",
    imageGroups.length === styles,
    `${imageGroups.length}/${styles} styles, ${images} images`,
  );
  // Was >= 8 before the phase-1f variation cap. Trimming colourways trims
  // their images with them, so the median fell from 9 to 5 BY DESIGN — the
  // cap keeps the richest colourways precisely so the carousel still has
  // material. 4 is the floor at which a gallery still reads as a gallery.
  check(
    "median images per style >= 4 (post-cap)",
    medianImages >= 4,
    `median ${medianImages}`,
  );

  // 3 — colourways and variations
  const colourways = await db.colourway.count();
  const variations = await db.variation.count();
  const cwGroups = await db.colourway.groupBy({ by: ["styleId"] });
  check(
    "every style has a colourway",
    cwGroups.length === styles,
    `${colourways} colourways, ${variations} variations`,
  );

  // 4 — clean sheet sums to baseline
  const sheets = await db.cleanSheet.groupBy({
    by: ["styleId"],
    where: { kind: "CLEAN_SHEET" },
    _sum: { amount: true },
  });
  check(
    "every style has clean sheet buckets",
    sheets.length === styles,
    `${sheets.length}/${styles}`,
  );

  // 5 — vendors
  const vendors = await db.vendor.count();
  const withRegion = await db.vendor.count({ where: { cooRegion: { not: null } } });
  const regions = await db.vendor.groupBy({ by: ["cooRegion"] });
  const newVendors = await db.vendor.count({ where: { isNewToQuince: true } });
  check("every vendor has a COO region", withRegion === vendors, `${withRegion}/${vendors}`);
  check(
    "all five COO regions present",
    regions.filter((r) => r.cooRegion).length === 5,
    regions.map((r) => r.cooRegion).join(", "),
  );
  check("both vendor types present", newVendors > 0 && newVendors < vendors, `${newVendors} new`);

  // 6 — lookups
  const tariffs = await db.tariffRate.count();
  const logistics = await db.logisticsRate.count();
  const configs = await db.config.count();
  check("tariff table populated", tariffs > 1000, `${tariffs} rates`);
  check("logistics table populated", logistics > 500, `${logistics} rates`);
  check("config seeded", configs >= 9, `${configs} entries`);

  // 7 — bids
  const quotes = await db.quote.count();
  const bidGroups = await db.quote.groupBy({ by: ["styleId"], _count: { _all: true } });
  const threePlus = bidGroups.filter((g) => g._count._all >= 3).length;
  check(
    "~10 styles carry bids",
    bidGroups.length >= 8 && bidGroups.length <= 12,
    `${bidGroups.length} styles, ${quotes} quotes`,
  );
  check(
    "every bid style has 3+ bidders (rank band works)",
    threePlus === bidGroups.length,
    `${threePlus}/${bidGroups.length}`,
  );

  // 8 — competitiveness spread
  const bidStyles = await db.style.findMany({
    where: { quotes: { some: {} } },
    select: {
      styleNumber: true,
      baselineFob: true,
      quotes: { select: { fob: true } },
      // kind matters: the same table holds BASELINE and CLEAN_SHEET, and
      // summing both reads the target as double the baseline.
      cleanSheets: { where: { kind: "CLEAN_SHEET" }, select: { amount: true } },
    },
  });
  const bands = { strong: 0, competitive: 0, needsWork: 0, offTarget: 0 };
  for (const s of bidStyles) {
    const baseline = Number(s.baselineFob ?? 0);
    const clean = s.cleanSheets.reduce((t, c) => t + Number(c.amount), 0);
    if (!baseline || !clean || baseline <= clean) continue;
    for (const q of s.quotes) {
      const score = (baseline - Number(q.fob ?? 0)) / (baseline - clean);
      if (score >= 0.6) bands.strong++;
      else if (score >= 0.35) bands.competitive++;
      else if (score >= 0.1) bands.needsWork++;
      else bands.offTarget++;
    }
  }
  const bandsUsed = Object.values(bands).filter((n) => n > 0).length;
  check(
    "bids spread across all four bands",
    bandsUsed === 4,
    `strong ${bands.strong} · competitive ${bands.competitive} · needs work ${bands.needsWork} · off target ${bands.offTarget}`,
  );

  // 9 — China share, the number the demo turns on
  const awards = await db.award.findMany({
    select: { awardedDollars: true, vendor: { select: { cooRegion: true } } },
  });
  const total = awards.reduce((t, a) => t + Number(a.awardedDollars ?? 0), 0);
  const china = awards
    .filter((a) => a.vendor.cooRegion === "CHINA")
    .reduce((t, a) => t + Number(a.awardedDollars ?? 0), 0);
  const share = total ? china / total : 0;
  check(
    "China share is 28-30% (pre-tip)",
    share >= 0.28 && share <= 0.3,
    `${(share * 100).toFixed(1)}% of $${(total / 1e6).toFixed(1)}M`,
  );

  // 10 — award integrity: every allocated style totals exactly 100%
  const byStyle = await db.award.groupBy({
    by: ["styleId"],
    _sum: { awardPct: true },
  });
  const bad = byStyle.filter((g) => Math.abs(Number(g._sum.awardPct) - 100) > 0.01);
  check(
    "every allocated style totals exactly 100%",
    bad.length === 0,
    `${byStyle.length} styles allocated${bad.length ? `, ${bad.length} wrong` : ""}`,
  );

  // Styles left open for the live demo.
  const unbid = styles - bidGroups.length;
  check("styles left unbid for the live demo", unbid > 60, `${unbid} styles`);

  // --- VARIATION GRAIN (phase 1f) ---

  const varGroups = await db.variation.groupBy({
    by: ["styleId"],
    _count: { _all: true },
    _sum: { volumeShare: true, planUnits: true },
  });

  // The demo cap. A product with 40 varGroups makes an expanded catalog row
  // unreadable, which is the whole reason cap.ts exists.
  const overCap = varGroups.filter((v) => v._count._all > 5);
  check(
    "no product exceeds 5 varGroups (demo cap)",
    overCap.length === 0,
    `max ${Math.max(...varGroups.map((v) => v._count._all))} per style`,
  );

  check(
    "every style has at least one variation",
    varGroups.length === styles,
    `${varGroups.length} of ${styles} styles`,
  );

  // volumeShare MUST still sum to 1 after the cap trimmed rows — a share
  // that sums to 0.6 silently understates every derived size allocation.
  const badShare = varGroups.filter(
    (v) => Math.abs(Number(v._sum.volumeShare ?? 0) - 1) > 0.001,
  );
  check(
    "volumeShare sums to 1.0 per style after the cap",
    badShare.length === 0,
    `${varGroups.length - badShare.length} of ${varGroups.length} styles`,
  );

  // Variation plan units must reconcile to the style's, or wave coverage
  // divides a variation numerator by a style denominator and reads wrong.
  const styleUnits = new Map(
    (
      await db.style.findMany({ select: { id: true, planUnits: true } })
    ).map((s) => [s.id, s.planUnits ?? 0]),
  );
  const badUnits = varGroups.filter(
    (v) =>
      Math.abs(Number(v._sum.planUnits ?? 0) - (styleUnits.get(v.styleId) ?? 0)) >
      5,
  );
  check(
    "variation plan units reconcile to the style total",
    badUnits.length === 0,
    `${varGroups.length - badUnits.length} of ${varGroups.length} styles`,
  );

  // All four grains must be present, or the demo cannot show the range.
  const grains = await db.style.groupBy({
    by: ["variationLevel"],
    _count: { _all: true },
  });
  const present = new Set(grains.map((g) => g.variationLevel));
  check(
    "all four grains present for the demo",
    ["STYLE", "COLOUR", "SIZE", "SKU"].every((g) => present.has(g)),
    grains.map((g) => `${g.variationLevel} ${g._count._all}`).join(" · "),
  );

  console.log(
    `\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failing check${failures === 1 ? "" : "s"}\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().finally(async () => {
  await db.$disconnect();
});
