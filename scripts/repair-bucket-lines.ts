/**
 * ONE-OFF: make every stored quote's line values add up to its bucket totals
 * (Tony, 9 Oct — Compare bids "drop-downs do not add up"). FOB, bucket totals
 * and therefore every landed figure are untouched; only `values` changes.
 *
 *   set -a; . ./.env; set +a; npx tsx scripts/repair-bucket-lines.ts [--dry]
 *
 * Safe to re-run: a quote that already adds up is skipped.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { computeQuote, reconcileToBuckets, type BucketTotals, type QuoteValues } from "../src/domain/quote";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set — source .env first");
const db = new PrismaClient({ adapter: new PrismaMariaDb(url) });
const dry = process.argv.includes("--dry");

type Line = { key: string; derived?: boolean; inputType?: string };
type Definition = {
  craftingFormula?: string;
  materialFormula?: string;
  sections?: { key: string; lines?: Line[] }[];
};

function specOf(def: Definition | null) {
  const keysOf = (key: string) =>
    (def?.sections?.find((s) => s.key === key)?.lines ?? [])
      .filter((l) => !l.derived && l.inputType === "currency")
      .map((l) => l.key);
  return {
    craftingFormula: (def?.craftingFormula ?? "CPM_OVER_EFFICIENCY") as "CPM_OVER_EFFICIENCY",
    materialFormula: (def?.materialFormula ?? "ADDITIVE_PER_METER") as "ADDITIVE_PER_METER",
    trimKeys: keysOf("TRIM_HARDWARE"),
    packagingKeys: keysOf("PACKAGING"),
  };
}

async function main() {
  const quotes = await db.quote.findMany({
    select: {
      id: true,
      values: true,
      bucketTotals: true,
      invitation: { select: { rfp: { select: { template: { select: { definition: true } } } } } },
    },
  });

  let fixed = 0;
  for (const q of quotes) {
    const target = (q.bucketTotals ?? {}) as Partial<BucketTotals>;
    if (!Object.keys(target).length || !q.values) continue;
    const spec = specOf(q.invitation.rfp.template.definition as Definition | null);
    const values = q.values as QuoteValues;
    const before = computeQuote(values, spec).buckets;
    const off = (Object.keys(target) as (keyof BucketTotals)[]).some(
      (k) => Math.abs((before[k] ?? 0) - (target[k] ?? 0)) > 0.005,
    );
    if (!off) continue;
    const next = reconcileToBuckets(values, spec, target);
    if (!dry) await db.quote.update({ where: { id: q.id }, data: { values: next as never } });
    fixed++;
  }
  console.log(`${dry ? "Would fix" : "Fixed"} ${fixed} of ${quotes.length} quotes.`);
}

main().finally(() => db.$disconnect());
