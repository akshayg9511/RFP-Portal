import { db } from "@/lib/db";
import { handle, num, numOr } from "@/lib/api";
import { resolveBestCost } from "@/lib/bestCost";
import { loadRateBook } from "@/lib/rateBook";
import {
  awardGroups,
  FREIGHT_SPLIT_SELECT,
  VARIATION_SELECT,
} from "@/lib/variationGroups";
import {
  awaitingQuince,
  quinceLabel,
  turnOf,
  vendorLabel,
  type BidStatus,
} from "@/domain/bidStatus";

/**
 * @openapi
 * /api/bid-summary:
 *   get:
 *     summary: Every bid across every RFP — product x variant x vendor (Phase 3)
 *     description: >
 *       One group per product x variant, for every product on a DRAFT or
 *       ISSUED RFP (P1), with one row per nominated vendor beneath it — bid
 *       or not. Each row carries the full freight chain for BOTH bases, the
 *       basis in use and whether Quince overrode it (P3), resolved on the
 *       variant's own air/ocean split (P5). Award % is read-only (P8).
 *
 *       Returns everything in scope; the screen filters on the client, as
 *       Award Summary does. At ~150 seeded rows server-side filtering would
 *       be plumbing for its own sake — the real wave (~3,000 rows) will want
 *       it, and virtualised rows, which is noted for engineering.
 */
export function GET() {
  return handle(async () => {
    const [rates, rfpStyles] = await Promise.all([
      loadRateBook(),
      // P1 — products UNDER CONSIDERATION: on an RFP that is a draft or issued.
      db.rfpStyle.findMany({
        where: { rfp: { status: { in: ["DRAFT", "ISSUED"] } } },
        select: { styleId: true },
      }),
    ]);
    const styleIds = [...new Set(rfpStyles.map((r) => r.styleId))];

    const styles = await db.style.findMany({
      where: { id: { in: styleIds } },
      include: {
        variations: VARIATION_SELECT,
        freightSplits: FREIGHT_SPLIT_SELECT,
        images: { where: { isHero: true }, take: 1, select: { url: true } },
        currentSuppliers: { where: { variationId: null }, select: { vendorId: true } },
        invitationStyles: {
          where: { invitation: { rfp: { status: { in: ["DRAFT", "ISSUED"] } } } },
          select: {
            variationKey: true,
            cannotBid: true,
            invitation: {
              select: {
                id: true,
                rfp: {
                  select: { id: true, name: true, status: true, gm: true, sourcingPartner: true },
                },
                vendor: {
                  select: {
                    id: true, name: true, vendorCode: true,
                    countryIso: true, cooRegion: true, isNewToQuince: true,
                  },
                },
                bids: { select: { styleId: true, status: true } },
              },
            },
          },
        },
        quotes: {
          select: {
            id: true,
            invitationId: true,
            variationKey: true,
            status: true,
            fob: true,
            freightBasis: true,
            dutyType: true,
            ddpWest: true, ddpCentral: true, ddpEast: true,
            ddpWestAir: true, ddpCentralAir: true, ddpEastAir: true,
            productionLeadTime: true,
            maxVolumeCapacity: true,
            moq: true,
          },
        },
        awards: {
          select: { variationKey: true, vendorId: true, awardPct: true, awardedDollars: true },
        },
      },
    });

    const groups = styles.flatMap((style) => {
      const incumbents = new Set(style.currentSuppliers.map((c) => c.vendorId));
      const colours = [...new Set(style.variations.map((v) => v.colour).filter(Boolean))] as string[];

      return awardGroups(style, rates.blend).map((group) => {
        // Vendors nominated on THIS variant — or on the whole product, which
        // is what a pre-variation nomination means (J12).
        const nominations = style.invitationStyles.filter(
          (n) => n.variationKey === group.variationKey || n.variationKey === "@STYLE",
        );
        const seen = new Set<string>();
        const awardsHere = style.awards.filter((a) => a.variationKey === group.variationKey);

        const rows = nominations
          .filter((n) => {
            if (seen.has(n.invitation.id)) return false;
            seen.add(n.invitation.id);
            return true;
          })
          .map((n) => {
            const inv = n.invitation;
            const quote = style.quotes.find(
              (q) =>
                q.invitationId === inv.id &&
                q.variationKey === group.variationKey &&
                q.status === "SUBMITTED",
            );
            const status = (inv.bids.find((b) => b.styleId === style.id)?.status ??
              "INVITED") as BidStatus;
            const cost = quote
              ? resolveBestCost(quote, style, inv.vendor, rates, group.size, group.blend)
              : null;
            const award = awardsHere.find((a) => a.vendorId === inv.vendor.id);
            const lead = quote?.productionLeadTime ?? null;

            return {
              invitationId: inv.id,
              quoteId: quote?.id ?? null,
              rfp: inv.rfp,
              vendor: {
                ...inv.vendor,
                // Derived, never stored (Build Doc 3.7).
                type: inv.vendor.isNewToQuince
                  ? "NEW"
                  : incumbents.has(inv.vendor.id)
                    ? "INCUMBENT"
                    : "EXISTING",
              },
              /** Not bid: no submitted quote. A draft RFP cannot have one. */
              hasBid: cost !== null,
              notIssued: inv.rfp.status === "DRAFT",
              cannotBid: n.cannotBid,
              stage: {
                status,
                quinceLabel: quinceLabel(status),
                vendorLabel: vendorLabel(status),
                turn: turnOf(status),
                awaitingReview: awaitingQuince(status),
              },
              price: cost
                ? {
                    fob: num(quote!.fob),
                    quincePaid: {
                      ocean: cost.landedOcean,
                      air: cost.landedAir,
                      blend: cost.quinceBlend,
                    },
                    // Null unless BOTH modes were quoted (decided 5 Oct).
                    ddp:
                      cost.ddpBlend === null
                        ? null
                        : {
                            ocean: deliveredDdp(quote!.fob, [quote!.ddpWest, quote!.ddpCentral, quote!.ddpEast]),
                            air: deliveredDdp(quote!.fob, [quote!.ddpWestAir, quote!.ddpCentralAir, quote!.ddpEastAir]),
                            blend: cost.ddpBlend,
                          },
                    basis: cost.bestCostBasis,
                    automaticBasis: cost.automaticBasis,
                    overridden: cost.overridden,
                    bestCost: cost.bestCost,
                    /** Against the variant's CURRENT landed cost (P2). */
                    deltaPct: group.baselineLanded
                      ? (cost.bestCost - group.baselineLanded) / group.baselineLanded
                      : null,
                    /**
                     * Annual, IF this vendor took the whole variant. Never
                     * summed across one variant's vendors — that would count
                     * the same volume once per bidder (P9).
                     */
                    annualSavings: group.planUnits * (group.baselineLanded - cost.bestCost),
                  }
                : null,
              terms: quote
                ? {
                    leadTimeDays: lead,
                    capacity: quote.maxVolumeCapacity,
                    moq: quote.moq,
                  }
                : null,
              award: award
                ? { pct: numOr(award.awardPct), dollars: numOr(award.awardedDollars) }
                : null,
            };
          })
          // Cheapest first within a variant; not-bid rows last.
          .sort((a, b) => {
            if (!a.price && !b.price) return a.vendor.name.localeCompare(b.vendor.name);
            if (!a.price) return 1;
            if (!b.price) return -1;
            return a.price.bestCost - b.price.bestCost;
          });

        const priced = rows.filter((r) => r.price);
        const lowest = priced.length ? Math.min(...priced.map((r) => r.price!.bestCost)) : null;
        const allocatedPct = awardsHere.reduce((t, a) => t + numOr(a.awardPct), 0);

        return {
          key: `${style.id}|${group.variationKey}`,
          styleId: style.id,
          styleNumber: style.styleNumber,
          name: style.name,
          heroImage: style.images[0]?.url ?? null,
          division: style.division,
          department: style.department,
          subDepartment: style.subDepartment,
          material: style.material,
          colours,
          variationId: group.variationId,
          variationLabel: group.label,
          planUnits: group.planUnits,
          /** The variant's current landed cost, from the current baseline (P2). */
          currentLanded: group.baselineLanded,
          split: { airPct: Math.round(group.blend.air * 100), set: group.splitSet },
          allocatedPct,
          allocated: Math.abs(allocatedPct - 100) < 0.005,
          lowestBestCost: lowest,
          rows,
        };
      });
    });

    // Groups with nobody nominated have nothing to show (P1).
    const withRows = groups
      .filter((g) => g.rows.length)
      .sort(
        (a, b) =>
          a.styleNumber.localeCompare(b.styleNumber) ||
          (a.variationId ? 1 : 0) - (b.variationId ? 1 : 0),
      );

    const allRows = withRows.flatMap((g) => g.rows);
    return {
      groups: withRows,
      counts: {
        all: allRows.length,
        awaitingReview: allRows.filter((r) => r.hasBid && r.stage.awaitingReview).length,
        notBid: allRows.filter((r) => !r.hasBid).length,
        unallocatedVariants: withRows.filter((g) => !g.allocated && g.rows.some((r) => r.hasBid)).length,
        variants: withRows.length,
      },
    };
  });
}

/** FOB + the HIGHEST destination fee — the same rule as lib/bestCost. */
function deliveredDdp(
  fob: Parameters<typeof num>[0],
  fees: Parameters<typeof num>[0][],
): number | null {
  const f = num(fob);
  const present = fees.map((x) => num(x)).filter((x): x is number => x !== null);
  return f === null || !present.length ? null : f + Math.max(...present);
}
