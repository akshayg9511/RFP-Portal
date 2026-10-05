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
    where: { kind: "CLEAN_SHEET", variationId: null },
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
      // variationId: null is the STYLE-LEVEL target. Without that filter
      // this sums the style's rows PLUS every variation's, inflating the
      // target so no bid lands in any band.
      cleanSheets: {
        where: { kind: "CLEAN_SHEET", variationId: null },
        select: { amount: true },
      },
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

  // 10 — award integrity: every VARIATION totals exactly 100%.
  //
  // Was grouped by styleId, which became wrong the moment awards went
  // per variation (N1): a correctly-allocated 5-size product summed to 500%
  // and read as broken. That is the D2 scope error in the GATE rather than
  // the product — the fix is to check at the right scope, not to loosen it.
  // A STYLE-grained product is one group keyed '@STYLE', so it is still
  // checked exactly as before.
  const byStyle = await db.award.groupBy({
    by: ["styleId", "variationKey"],
    _sum: { awardPct: true },
  });
  const bad = byStyle.filter((g) => Math.abs(Number(g._sum.awardPct) - 100) > 0.01);
  check(
    "every allocated VARIATION totals exactly 100%",
    bad.length === 0,
    `${byStyle.length} variation groups allocated${bad.length ? `, ${bad.length} wrong` : ""}`,
  );

  /**
   * 10b — NO DOUBLE-COUNTED VOLUME.
   *
   * Each variation's awardedUnits must be its OWN share of plan units. If a
   * mapper hands every group the style's whole volume, awarded units for a
   * 5-size product come to ~5x the plan — and vendor spend inflates the same
   * 5x, straight through the $20M cap check. So: per style, awarded units
   * across all its groups and vendors must not exceed the style's plan.
   */
  const unitRows = await db.award.groupBy({
    by: ["styleId"],
    _sum: { awardedUnits: true },
  });
  const plans = new Map(
    (
      await db.style.findMany({
        where: { id: { in: unitRows.map((u) => u.styleId) } },
        select: { id: true, planUnits: true },
      })
    ).map((p) => [p.id, p.planUnits ?? 0]),
  );
  // 1% tolerance: variation plan units are rounding dust off the style total
  // (±9 on ~150,000), the reason coverage uses a tolerance, never equality.
  const inflated = unitRows.filter(
    (u) => (u._sum.awardedUnits ?? 0) > (plans.get(u.styleId) ?? 0) * 1.01,
  );
  check(
    "awarded units never exceed a style's plan (no double-count)",
    inflated.length === 0,
    `${unitRows.length} styles · ${inflated.length} over plan`,
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

  // --- PER-VARIATION COST (phase 1.5a) ---

  // Every variation needs its own bucket set, or the drawer's dropdown shows
  // an empty cost breakdown for some sizes.
  const varCost = await db.cleanSheet.groupBy({
    by: ["variationId"],
    where: { variationId: { not: null }, kind: "BASELINE" },
    _count: { _all: true },
    _sum: { amount: true },
  });
  const varTotal = await db.variation.count();
  check(
    "every variation has its own cost buckets",
    varCost.length === varTotal,
    `${varCost.length} of ${varTotal} variations`,
  );

  // THE invariant that makes the figures trustworthy: a variation's buckets
  // must sum to ITS baseline FOB, exactly as the style-level ones sum to the
  // style's. If this drifts, the drawer shows a total nobody pays.
  const varFobs = new Map(
    (
      await db.variation.findMany({ select: { id: true, baselineFob: true } })
    ).map((v) => [v.id, Number(v.baselineFob ?? 0)]),
  );
  const badSum = varCost.filter((row) => {
    const expected = varFobs.get(row.variationId ?? "") ?? 0;
    const actual = Number(row._sum.amount ?? 0);
    // A cent of tolerance: the scale factor is a float.
    return expected > 0 && Math.abs(actual - expected) > 0.01;
  });
  check(
    "per-variation buckets sum to that variation's baseline FOB",
    badSum.length === 0,
    `${varCost.length - badSum.length} of ${varCost.length} variations`,
  );

  // The point of the whole exercise: if every size carried the same cost the
  // dropdown would be decoration.
  const spread = await db.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT COUNT(*) AS n FROM (
       SELECT styleId FROM CleanSheet
       WHERE variationId IS NOT NULL AND kind = 'BASELINE'
         AND bucket = 'BASE_MATERIALS'
       GROUP BY styleId HAVING COUNT(DISTINCT amount) > 1
     ) x`,
  );
  check(
    "cost genuinely varies between a style's variations",
    Number(spread[0]?.n ?? 0) > 20,
    `${Number(spread[0]?.n ?? 0)} styles with differing per-size materials`,
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

  /**
   * QUOTES SIT AT THE PRODUCT'S OWN GRAIN.
   *
   * The seed used to bid every product whole, which left 19 quote rows
   * style-level on SIZE-grain products: the vendor form then offered "quote
   * this product whole" for a product configured to bid per size, and
   * `pricedVariations` was empty everywhere. Nothing failed — it just made
   * Phase 2a undemoable. Asserted so it cannot drift back.
   */
  const quotesByGrain = await db.quote.findMany({
    select: { variationId: true, style: { select: { variationLevel: true } } },
  });
  const misgrained = quotesByGrain.filter((q) =>
    q.style.variationLevel === "STYLE"
      ? q.variationId !== null
      : q.variationId === null,
  );
  check(
    "every quote sits at its product's own grain",
    misgrained.length === 0,
    `${quotesByGrain.length} quotes · ${misgrained.length} at the wrong grain`,
  );

  /**
   * variationKey MUST BE variationKeyOf(variationId).
   *
   * The seed briefly wrote the GROUP LABEL ("Cal King") while every route
   * keys on the variation id, so the quote route's upsert missed its own row
   * and INSERTED A DUPLICATE on the vendor's first save — a 6th row on a
   * 5-size product, with the real row left untouched. Nothing errored.
   * This is the unique key the whole @STYLE sentinel exists to make bite, so
   * a mismatch is asserted rather than trusted.
   */
  const keyRows = await db.quote.findMany({
    select: { variationId: true, variationKey: true },
  });
  const badKeys = keyRows.filter(
    (r) => r.variationKey !== (r.variationId ?? "@STYLE"),
  );
  check(
    "every quote's variationKey matches variationKeyOf(variationId)",
    badKeys.length === 0,
    `${keyRows.length} quotes · ${badKeys.length} mismatched`,
  );

  /**
   * DDP IS A PER-PRODUCT TERM, FOB IS PER VARIANT.
   *
   * One declaration has to reach every variant row or lib/bestCost.ts sees a
   * product that is DDP for Twin and not for King — which changes Best Cost
   * for some sizes and not others.
   */
  const ddpRows = await db.quote.findMany({
    select: {
      invitationId: true,
      styleId: true,
      dutyType: true,
      ddpWest: true,
      fob: true,
    },
  });
  const byProduct = new Map<string, typeof ddpRows>();
  for (const r of ddpRows) {
    const k = `${r.invitationId}|${r.styleId}`;
    byProduct.set(k, [...(byProduct.get(k) ?? []), r]);
  }
  const multi = [...byProduct.values()].filter((rows) => rows.length > 1);
  const ddpSplit = multi.filter(
    (rows) =>
      new Set(rows.map((r) => r.dutyType)).size > 1 ||
      new Set(rows.map((r) => String(r.ddpWest))).size > 1,
  );
  check(
    "DDP terms are uniform across a product's variants",
    ddpSplit.length === 0,
    `${multi.length} multi-variant products · ${ddpSplit.length} with split DDP`,
  );

  const fobFlat = multi.filter(
    (rows) => new Set(rows.map((r) => String(r.fob))).size === 1,
  );
  check(
    "FOB genuinely differs between a product's variants",
    fobFlat.length === 0,
    `${multi.length} multi-variant products · ${fobFlat.length} quoting one price for every size`,
  );

  /**
   * DDP IS NEVER BELOW FOB — the fee fix, 5 Oct.
   *
   * The columns hold the vendor's FEE on top of FOB. A negative fee would mean
   * a delivered DDP price under FOB, which Akshay ruled out ("DDP is always FOB
   * plus their logistics cost") — and which is exactly how the 2a.4 bug read.
   */
  const ddpFees = await db.quote.findMany({
    where: { dutyType: "VDDP" },
    select: {
      ddpWest: true, ddpCentral: true, ddpEast: true,
      ddpWestAir: true, ddpCentralAir: true, ddpEastAir: true,
    },
  });
  const negative = ddpFees.filter((q) =>
    Object.values(q).some((v) => v !== null && Number(v) < 0),
  );
  check(
    "DDP fees are never negative (delivered DDP >= FOB)",
    ddpFees.length > 0 && negative.length === 0,
    `${ddpFees.length} DDP quotes · ${negative.length} below FOB`,
  );

  console.log(
    `\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failing check${failures === 1 ? "" : "s"}\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().finally(async () => {
  await db.$disconnect();
});
