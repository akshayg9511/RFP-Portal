import { db } from "@/lib/db";
import { badRequest, handle, notFound } from "@/lib/api";
import {
  allocate,
  type AllocationResult,
  type VendorAllocation,
} from "@/domain/award";
import { strategies } from "@/domain/strategies";
import { resolveBestCost } from "@/lib/bestCost";
import { loadRateBook } from "@/lib/rateBook";
import {
  awardGroups,
  FREIGHT_SPLIT_SELECT,
  VARIATION_SELECT,
  type AwardGroup,
} from "@/lib/variationGroups";

/**
 * @openapi
 * /api/styles/{id}/award:
 *   put:
 *     summary: Save an award split — per VARIATION (N1, 5 Oct)
 *     description: >
 *       Awarding is variation-level. Each variation totals exactly 100% on its
 *       own (D2) — the one hard validation in the product, never overridable.
 *       The SERVER decides what is stored: Best Cost is re-resolved from the
 *       quotes for each variation, so a stale client cannot write a price
 *       nobody quoted.
 *
 *       Three modes:
 *         - one variation   { variationId, allocations }
 *         - copy to all     { allocations, applyToAll: true }
 *         - strategy to all { strategyKey, applyToAll: true } — re-computed
 *           PER variation, since the cheapest vendor on Twin need not be the
 *           cheapest on King (N5)
 *       A status of READY_FOR_REVIEW or AWARDED commits the WHOLE product and
 *       is refused unless every variation is at exactly 100%.
 *     responses:
 *       200: { description: The saved allocation }
 *       400: { description: Not 100%, a vendor with no bid, or incomplete variations }
 *       404: { description: No such style }
 */

type Body = {
  /** The group this save is for. Omitted = the product's only/first group. */
  variationId?: string | null;
  allocations?: { vendorId: string; awardPct: number }[];
  /** Copy this split (or this strategy) to every variation. */
  applyToAll?: boolean;
  /** A built-in strategy, computed per variation from that variation's bids. */
  strategyKey?: string;
  comment?: string | null;
  status?: "ALLOCATED" | "READY_FOR_REVIEW" | "AWARDED";
};

export function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const { id } = await params;
    const body = (await request.json()) as Body;

    const [rates, style] = await Promise.all([
      loadRateBook(),
      db.style.findUnique({
        where: { id },
        include: {
          variations: VARIATION_SELECT,
          freightSplits: FREIGHT_SPLIT_SELECT,
          currentSuppliers: {
            where: { variationId: null },
            select: { vendorId: true },
          },
          quotes: {
            where: { status: "SUBMITTED" },
            select: {
              freightBasis: true,
              fob: true,
              vendorId: true,
              variationKey: true,
              ddpWest: true,
              ddpCentral: true,
              ddpEast: true,
              ddpWestAir: true,
              ddpCentralAir: true,
              ddpEastAir: true,
              vendor: {
                select: {
                  id: true,
                  name: true,
                  cooRegion: true,
                  countryIso: true,
                  isNewToQuince: true,
                },
              },
            },
          },
        },
      }),
    ]);
    if (!style) return notFound(`Style ${id}`);

    const wave = await db.wave.findFirst({ orderBy: { createdAt: "desc" } });
    if (!wave) return badRequest("No wave exists");

    const groups = awardGroups(style, rates.blend);
    const incumbents = new Set(style.currentSuppliers.map((c) => c.vendorId));

    /** One group's split → priced, validated allocation, or the reason not. */
    function priceGroup(
      group: AwardGroup,
      split: { vendorId: string; awardPct: number }[],
    ): { ok: true; result: AllocationResult } | { ok: false; reason: string } {
      const quotes = new Map(
        style!.quotes
          .filter((q) => q.variationKey === group.variationKey)
          .map((q) => [q.vendorId, q]),
      );
      const vendors: VendorAllocation[] = [];
      // Zero rows are how a vendor is removed; they are not a decision.
      for (const a of split.filter((x) => x.awardPct > 0)) {
        const quote = quotes.get(a.vendorId);
        if (!quote) {
          return {
            ok: false,
            reason: `a vendor in the split has no bid on ${group.label}`,
          };
        }
        const cost = resolveBestCost(quote, style!, quote.vendor, rates, group.size, group.blend);
        if (!cost) return { ok: false, reason: `no price on ${group.label}` };
        vendors.push({
          vendorId: a.vendorId,
          vendorName: quote.vendor.name,
          cooRegion: quote.vendor.cooRegion,
          awardPct: a.awardPct,
          bestCost: cost.bestCost,
          bestCostBasis: cost.bestCostBasis,
          isNewToQuince: quote.vendor.isNewToQuince,
        });
      }
      const result = allocate({
        styleId: style!.id,
        // THE GROUP'S OWN VOLUME. Handing a group the style's whole plan
        // inflates awarded units and vendor spend ~5x (§traps #3).
        planUnits: group.planUnits,
        baselineLanded: group.baselineLanded,
        vendors,
      });
      if (!result.isValid) {
        return {
          ok: false,
          reason: `${group.label} totals ${result.allocatedPct}%, not 100%`,
        };
      }
      return { ok: true, result };
    }

    /** Built-in strategies, computed from ONE group's bids. */
    function strategySplit(group: AwardGroup, key: string) {
      const bids = style!.quotes
        .filter((q) => q.variationKey === group.variationKey)
        .map((q) => {
          const cost = resolveBestCost(q, style!, q.vendor, rates, group.size, group.blend);
          return cost
            ? {
                vendorId: q.vendorId,
                bestCost: cost.bestCost,
                cooRegion: q.vendor.cooRegion,
                isNewToQuince: q.vendor.isNewToQuince,
                isCurrentSupplier: incumbents.has(q.vendorId),
              }
            : null;
        })
        .filter((b): b is NonNullable<typeof b> => b !== null);
      const found = strategies(bids).find((s) => s.key === key);
      if (!found || found.unavailable) return null;
      return Object.entries(found.split).map(([vendorId, awardPct]) => ({
        vendorId,
        awardPct: awardPct as number,
      }));
    }

    // ── 1. Which groups this save writes, and with what split ─────────────
    const writes: { group: AwardGroup; result: AllocationResult }[] = [];
    const skipped: { label: string; reason: string }[] = [];

    const targets = body.applyToAll
      ? groups
      : [
          groups.find((g) => g.variationId === (body.variationId ?? null)) ??
            groups[0]!,
        ];

    if (body.allocations || body.strategyKey) {
      for (const group of targets) {
        const split = body.strategyKey
          ? strategySplit(group, body.strategyKey)
          : body.allocations!;
        if (!split) {
          skipped.push({
            label: group.label,
            reason: "this strategy is not available here",
          });
          continue;
        }
        const priced = priceGroup(group, split);
        if (!priced.ok) {
          // One variation, explicitly: refuse. Never overridable.
          if (!body.applyToAll) {
            return badRequest(`Award must total exactly 100%: ${priced.reason}.`);
          }
          // Copying to all: apply where it CAN be, and say where it could
          // not — a vendor who did not bid Cal King cannot be copied onto it.
          skipped.push({ label: group.label, reason: priced.reason });
          continue;
        }
        writes.push({ group, result: priced.result });
      }
      if (!writes.length) {
        return badRequest(
          `Nothing could be applied: ${skipped.map((s) => `${s.label} (${s.reason})`).join("; ")}.`,
        );
      }
    }

    // ── 2. A product-level commit needs EVERY variation at 100% ───────────
    const status = body.status ?? "ALLOCATED";
    if (status !== "ALLOCATED") {
      const stored = await db.award.groupBy({
        by: ["variationKey"],
        where: { waveId: wave.id, styleId: style.id },
        _sum: { awardPct: true },
      });
      const pct = new Map(
        stored.map((r) => [r.variationKey, Number(r._sum.awardPct ?? 0)]),
      );
      // This request's writes count as already stored.
      for (const w of writes) pct.set(w.group.variationKey, w.result.allocatedPct);

      const incomplete = groups.filter(
        (g) => Math.abs((pct.get(g.variationKey) ?? 0) - 100) > 0.005,
      );
      if (incomplete.length) {
        return badRequest(
          `Every variation must be at 100% before this product can move on. ` +
            `Not yet: ${incomplete.map((g) => g.label).join(", ")}.`,
        );
      }
    }

    // ── 3. Award release to vendors (only on AWARDED) ─────────────────────
    const invitationUpdates: { id: string; status: string }[] = [];
    if (status === "AWARDED") {
      // Winners across EVERY variation of the product, from storage plus
      // this request — a vendor who won only King still won.
      const storedWinners = await db.award.findMany({
        where: { waveId: wave.id, styleId: style.id },
        select: { vendorId: true, variationKey: true },
      });
      const rewritten = new Set(writes.map((w) => w.group.variationKey));
      const winners = new Set([
        ...storedWinners
          .filter((a) => !rewritten.has(a.variationKey))
          .map((a) => a.vendorId),
        ...writes.flatMap((w) => w.result.lines.map((l) => l.vendorId)),
      ]);
      const invited = await db.invitation.findMany({
        where: { styles: { some: { styleId: style.id } }, rfp: { status: "ISSUED" } },
        select: { id: true, vendorId: true },
      });
      for (const inv of invited) {
        invitationUpdates.push({
          id: inv.id,
          status: winners.has(inv.vendorId) ? "AWARDED" : "NOT_PROCEEDING",
        });
      }
    }

    const stamp =
      status === "AWARDED"
        ? { awardedAt: new Date(), awardedBy: "Procurement" }
        : { awardedAt: null, awardedBy: null };

    // ── 4. Write — each touched group replaced wholesale, in one transaction
    // so no group is ever left at a total other than 100.
    await db.$transaction([
      ...writes.flatMap((w) => [
        db.award.deleteMany({
          where: {
            waveId: wave.id,
            styleId: style.id,
            variationKey: w.group.variationKey,
          },
        }),
        db.award.createMany({
          data: w.result.lines.map((line) => ({
            waveId: wave.id,
            styleId: style.id,
            vendorId: line.vendorId,
            variationId: w.group.variationId,
            variationKey: w.group.variationKey,
            awardPct: line.awardPct,
            bestCost: line.bestCost,
            bestCostBasis: line.bestCostBasis,
            awardedUnits: line.awardedUnits,
            awardedDollars: line.awardedDollars,
            savingsDollars: line.savingsDollars,
            status,
            comment: body.comment?.trim() || null,
            ...stamp,
          })),
        }),
      ]),
      // A product-level status move applies to EVERY variation's rows, so
      // the product's variations can never be at different stages.
      ...(status !== "ALLOCATED" || writes.length
        ? [
            db.award.updateMany({
              where: { waveId: wave.id, styleId: style.id },
              data: {
                status,
                ...stamp,
                ...(body.comment !== undefined
                  ? { comment: body.comment?.trim() || null }
                  : {}),
              },
            }),
          ]
        : []),
      ...invitationUpdates.map((u) =>
        db.invitation.update({ where: { id: u.id }, data: { status: u.status } }),
      ),
    ]);

    return {
      styleId: style.id,
      status,
      applied: writes.map((w) => w.group.label),
      skipped,
      vendorsNotified: invitationUpdates.length,
      totalAwardedDollars: writes.reduce((s, w) => s + w.result.totalAwardedDollars, 0),
      totalSavingsDollars: writes.reduce((s, w) => s + w.result.totalSavingsDollars, 0),
    };
  });
}
