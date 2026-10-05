"use client";

import * as React from "react";
import { Badge, Icon } from "@/ds/components";
import { money, percent, unitCost, units, moneyCompact } from "@/lib/format";
import type { allocate } from "@/domain/award";
import type { RegionSplit } from "@/domain/strategies";
import { BASIS_LABEL, vendorType, type ProductBids } from "../types";
import { Readout } from "./page";

/**
 * The allocate tab: type a percentage, watch the consequence.
 *
 * The readout sits ABOVE the inputs. That looks backwards until you use it —
 * the numbers are what you are steering toward, so they must not be below the
 * control that moves them, or every keystroke costs a scroll. This is the
 * defect the drawer had, and the whole reason this became a page.
 */
export function AllocateTab({
  data,
  pct,
  result,
  regions,
  baseline,
  planUnits,
  applied,
  comment,
  onPct,
  onComment,
  onCopyToAll,
  busy,
}: {
  data: ProductBids;
  pct: Record<string, string>;
  result: ReturnType<typeof allocate> | null;
  regions: RegionSplit[];
  baseline: number;
  planUnits: number;
  /** Label of the strategy currently filling the inputs, if any. */
  applied: string | null;
  comment: string;
  onPct: (vendorId: string, value: string) => void;
  onComment: (value: string) => void;
  /** N3 — copy this variation's split to every variation of the product. */
  onCopyToAll?: () => void;
  busy?: boolean;
}) {
  const lineFor = (vendorId: string) =>
    result?.lines.find((l) => l.vendorId === vendorId);

  const cheapest = Math.min(...data.bids.map((b) => b.bestCost));

  return (
    <>
      <Readout result={result} baseline={baseline} planUnits={planUnits} />

      {applied ? (
        <p className="pd-applied">
          <Icon name="check" size="sm" />
          Filled from <strong>{applied}</strong>. Every percentage is still
          editable.
        </p>
      ) : null}

      {/* WHICH VARIATION, AND HOW MANY ARE DONE (N2/N3).

          Each variation totals 100 on its own, so the buyer needs to see
          both what they are allocating now and what is left. The product
          cannot move to review until every one is done, and the server names
          the ones that are not. */}
      {data.variations.length > 1 ? (
        <div className="pd-var-strip">
          <span>
            Allocating <strong>{data.bids[0]?.variationLabel ?? "this variation"}</strong>
            {" · "}
            {
              data.variations.filter(
                (v) => Math.abs(v.allocatedPct - 100) < 0.005,
              ).length
            }{" "}
            of {data.variations.length} variations allocated
          </span>
          {onCopyToAll ? (
            <button
              className="btn btn--ghost sm"
              disabled={busy || !result?.isValid}
              onClick={onCopyToAll}
              title={
                result?.isValid
                  ? undefined
                  : "Bring this variation to exactly 100% first"
              }
            >
              Copy this split to all variations
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="pd-cols">
        <section className="pd-alloc">
          <table className="pd-table">
            <thead>
              <tr>
                <th>Vendor</th>
                <th className="num">Best cost</th>
                <th className="num">Award %</th>
                <th className="num">Awarded</th>
                <th className="num">Saving</th>
              </tr>
            </thead>
            <tbody>
              {data.bids.map((b) => {
                const line = lineFor(b.vendorId);
                const value = pct[b.vendorId] ?? "";
                const share = Number(value) || 0;
                const capacityShort =
                  !!b.maxVolumeCapacity &&
                  b.maxVolumeCapacity < Math.round(planUnits * (share / 100));

                return (
                  <tr key={b.vendorId} className={share > 0 ? "is-on" : undefined}>
                    <td>
                      <div className="pd-vend">
                        <span className="pd-vend-n">{b.vendorName}</span>
                        <Badge>{vendorType(b)}</Badge>
                        {b.bestCost === cheapest ? (
                          <Badge tone="success">Lowest</Badge>
                        ) : null}
                      </div>
                      <div className="pd-vend-m">
                        <span className="id">{b.vendorCode}</span>
                        {b.cooRegion ? ` · ${b.cooRegion}` : ""}
                        {b.productionLeadTime
                          ? ` · ${b.productionLeadTime}d lead`
                          : ""}
                      </div>
                      {/* A cheaper vendor who cannot make the volume is not
                          cheaper. Warned at the share actually typed, not at
                          full volume, so it appears only when it is true. */}
                      {capacityShort ? (
                        <div className="pd-vend-warn">
                          <Icon name="alert_triangle" size="sm" />
                          Capacity {units(b.maxVolumeCapacity)}/yr is under this
                          share
                        </div>
                      ) : null}
                    </td>

                    <td className="num">
                      {unitCost(b.bestCost)}
                      <span className="pd-basis">
                        {BASIS_LABEL[b.bestCostBasis]}
                      </span>
                    </td>

                    <td className="num">
                      <div className="control sm pd-pct">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step="any"
                          inputMode="decimal"
                          value={value}
                          placeholder="0"
                          aria-label={`Award percent for ${b.vendorName}`}
                          onChange={(e) => onPct(b.vendorId, e.target.value)}
                        />
                      </div>
                    </td>

                    <td className="num">
                      {share > 0 ? (
                        <>
                          {moneyCompact(line?.awardedDollars ?? 0)}
                          <span className="pd-basis">
                            {units(line?.awardedUnits ?? 0)} units
                          </span>
                        </>
                      ) : (
                        <span className="pd-none">—</span>
                      )}
                    </td>

                    <td className="num">
                      {share > 0 ? (
                        <span
                          className={
                            (line?.savingsDollars ?? 0) >= 0 ? "pos" : "neg"
                          }
                        >
                          {moneyCompact(line?.savingsDollars ?? 0)}
                        </span>
                      ) : (
                        <span className="pd-none">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="field pd-comment">
            <label className="lbl" htmlFor="pd-note">
              Why this split
              <span className="hint"> — travels with the award</span>
            </label>
            <div className="control textarea">
              <textarea
                id="pd-note"
                rows={2}
                value={comment}
                placeholder="The reasoning a reviewer needs. Capacity, risk, a conversation held off-system."
                onChange={(e) => onComment(e.target.value)}
              />
            </div>
          </div>
        </section>

        <RegionPanel regions={regions} total={result?.totalAwardedDollars ?? 0} />
      </div>
    </>
  );
}

/**
 * Where this product's money goes, by sourcing region.
 *
 * INFORMATIONAL. No cap, no range, no breach colour — a per-product cap was
 * never coherent, because China's 30% ceiling is a property of the WAVE and
 * this is one of ~10 contributors to it. Wave Insights owns the guardrails.
 *
 * All five regions are always listed, each named. Grouping the small ones into
 * "Other" would hide which region you are actually shifting into, which is the
 * one thing this panel exists to tell you.
 */
function RegionPanel({
  regions,
  total,
}: {
  regions: RegionSplit[];
  total: number;
}) {
  const anyAllocated = total > 0;

  return (
    <aside className="pd-region">
      <div className="pd-region-h">
        <strong>Region split</strong>
        <span className="pd-region-sub">this product only</span>
      </div>

      <div className="pd-region-rows">
        {regions.map((r) => (
          <div
            className={r.noBids ? "pd-reg is-empty" : "pd-reg"}
            key={r.region}
          >
            <div className="pd-reg-top">
              <span className="pd-reg-n">{r.region}</span>
              <span className="pd-reg-v">
                {r.noBids ? (
                  <span className="pd-none">no bids</span>
                ) : (
                  percent(r.share, 0)
                )}
              </span>
            </div>
            <div className="pd-reg-bar">
              <span style={{ inlineSize: percent(r.share, 0) }} />
            </div>
            {r.dollars > 0 ? (
              <div className="pd-reg-d">{money(r.dollars)}</div>
            ) : null}
          </div>
        ))}
      </div>

      <p className="pd-region-note">
        {anyAllocated
          ? "Informational. Regional caps apply across the whole wave, not to one product — see Wave insights."
          : "Allocate a percentage to see where this product's spend lands."}
      </p>
    </aside>
  );
}
