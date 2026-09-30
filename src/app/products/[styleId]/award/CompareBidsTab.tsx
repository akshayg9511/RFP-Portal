"use client";

import * as React from "react";
import Link from "next/link";
import { Badge, Icon } from "@/ds/components";
import { money, unitCost, units } from "@/lib/format";
import {
  BASIS_LABEL,
  BUCKET_LABEL,
  BUCKET_ORDER,
  bucketLines,
  lineValue,
  vendorType,
  type Bid,
  type ProductBids,
} from "../types";

/**
 * COMPARE BIDS — every vendor on this product, side by side.
 *
 * This is the merge of two things that were the same table. There used to be a
 * `/products/[id]/bids` route AND a "Cost breakdown" tab, and the tab was a
 * strict subset of the route — same buckets, same clean sheet, same flags,
 * fewer rows. Two implementations of one table.
 *
 * VENDORS ARE COLUMNS, buckets are rows. The question is "why is this vendor
 * cheaper", and the answer is a row you read across. There is no
 * product/vendor toggle: the page IS one product, so a by-vendor view would
 * render one column. That pivot lives on Award Summary.
 *
 * EACH BUCKET EXPANDS into the lines behind it. The previous version had a
 * single "line items" row that dumped ~35 alphabetised camelCase keys per
 * vendor with no units and no grouping — `fabricWidth` next to `polyBag` next
 * to `productLeadTime`. The template has always grouped these by bucket with
 * real labels and units; the screen was throwing that structure away.
 */
export function CompareBidsTab({ data }: { data: ProductBids }) {
  const { bids, cleanSheet, style, template } = data;
  const baseline = style.baselineLanded ?? style.baselineFob ?? 0;
  const planUnits = style.planUnits ?? 0;

  /** Which buckets are expanded. Several may be open at once — comparing
   *  Materials and Crafting together is a real thing to want. */
  const [open, setOpen] = React.useState<Set<string>>(new Set());

  if (bids.length === 0) {
    return (
      <div className="empty compact">
        <span className="glyph">
          <Icon name="invoice" size="lg" />
        </span>
        <div className="ttl">No bids yet</div>
        <div className="desc">
          Vendors invited to this product have not submitted. Nothing to compare
          until at least one bid arrives.
        </div>
      </div>
    );
  }

  const buckets = BUCKET_ORDER.filter(
    (b) =>
      (cleanSheet?.buckets[b] ?? 0) > 0 ||
      bids.some((bid) => (bid.bucketTotals[b] ?? 0) > 0),
  );

  const cheapest = Math.min(...bids.map((b) => b.bestCost));
  const flagFor = (bid: Bid, bucket: string) =>
    bid.bucketFlags.find((f) => f.bucket === bucket)?.flag ?? null;

  function toggle(bucket: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(bucket)) next.delete(bucket);
      else next.add(bucket);
      return next;
    });
  }

  return (
    <div className="bc-wrap">
      <table className="bc-table">
        <thead>
          <tr>
            <th scope="col" className="bc-rowhead">
              Cost bucket
            </th>
            {cleanSheet ? (
              <th scope="col" className="bc-clean">
                Clean sheet
                <span className="bc-sub">our model</span>
              </th>
            ) : null}
            {bids.map((b) => (
              <th scope="col" key={b.vendorId} className="bc-vendor">
                {/* The vendor's own page answers "what else did they bid",
                    which is why this page needs no by-vendor toggle. */}
                <Link className="bc-vendor-name" href={`/vendors/${b.vendorId}`}>
                  {b.vendorName}
                </Link>
                <span className="bc-sub">
                  <span className="id">{b.vendorCode}</span>
                  {b.cooRegion ? ` · ${b.cooRegion}` : ""}
                </span>
                <span className="bc-type">
                  <Badge>{vendorType(b)}</Badge>
                  {b.bestCost === cheapest ? (
                    <Badge tone="success">Lowest</Badge>
                  ) : null}
                </span>
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {buckets.map((bucket) => {
            const isOpen = open.has(bucket);
            const lines = bucketLines(template?.definition, bucket);
            const expandable = lines.costs.length + lines.inputs.length > 0;

            return (
              <React.Fragment key={bucket}>
                <tr className={isOpen ? "bc-bucket is-open" : "bc-bucket"}>
                  <th scope="row" className="bc-rowhead">
                    {expandable ? (
                      <button
                        className="bc-expand"
                        onClick={() => toggle(bucket)}
                        aria-expanded={isOpen}
                      >
                        <Icon
                          name={isOpen ? "chevron_down" : "chevron_right"}
                          size="sm"
                        />
                        {BUCKET_LABEL[bucket] ?? bucket}
                      </button>
                    ) : (
                      <span className="bc-noexpand">
                        {BUCKET_LABEL[bucket] ?? bucket}
                      </span>
                    )}
                  </th>
                  {cleanSheet ? (
                    <td className="bc-clean">
                      {unitCost(cleanSheet.buckets[bucket] ?? 0)}
                    </td>
                  ) : null}
                  {bids.map((b) => {
                    const flag = flagFor(b, bucket);
                    return (
                      <td
                        key={b.vendorId}
                        className={
                          flag === "ABOVE"
                            ? "bc-num is-above"
                            : flag === "BELOW"
                              ? "bc-num is-below"
                              : "bc-num"
                        }
                      >
                        {unitCost(b.bucketTotals[bucket] ?? 0)}
                        {flag === "ABOVE" ? (
                          <span className="bc-flag" title="Above the clean sheet">
                            ▲
                          </span>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>

                {isOpen ? (
                  <>
                    {/* COSTS first — these are what add up to the bucket. */}
                    {lines.costs.length ? (
                      <LineGroup
                        label="Cost lines"
                        lines={lines.costs}
                        bids={bids}
                        cleanSheet={!!cleanSheet}
                        money
                      />
                    ) : null}
                    {/* Then the INPUTS that drive them: consumption, wastage,
                        SAM. This is the half that answers "why". */}
                    {lines.inputs.length ? (
                      <LineGroup
                        label="Inputs behind them"
                        lines={lines.inputs}
                        bids={bids}
                        cleanSheet={!!cleanSheet}
                      />
                    ) : null}
                  </>
                ) : null}
              </React.Fragment>
            );
          })}

          <tr className="bc-total">
            <th scope="row" className="bc-rowhead">
              FOB
            </th>
            {cleanSheet ? (
              <td className="bc-clean">{unitCost(cleanSheet.fob)}</td>
            ) : null}
            {bids.map((b) => (
              <td key={b.vendorId} className="bc-num">
                {unitCost(b.fob)}
              </td>
            ))}
          </tr>

          {/* The chain, not just the answer. A buyer who sees only Best Cost
              cannot tell whether a vendor won on price or on freight — and
              tariff omitted from one comparison is the real Wave 1 error this
              product exists to prevent.

              These rows do NOT expand: they are computed by domain/cost.ts
              from one FOB, so there is nothing underneath to show. */}
          <ChainRow label="Landed · ocean" bids={bids} pick={(b) => b.landedOcean} cleanSheet={!!cleanSheet} />
          <ChainRow label="Landed · air" bids={bids} pick={(b) => b.landedAir} cleanSheet={!!cleanSheet} />
          <ChainRow label="Quince blend 70/30" bids={bids} pick={(b) => b.quinceBlend} cleanSheet={!!cleanSheet} />
          <ChainRow label="Vendor DDP" bids={bids} pick={(b) => b.ddpBlend} cleanSheet={!!cleanSheet} />

          <tr className="bc-best">
            <th scope="row" className="bc-rowhead">
              Best cost
              <span className="bc-sub">the lower of the two blends</span>
            </th>
            {cleanSheet ? <td className="bc-clean" /> : null}
            {bids.map((b) => (
              <td key={b.vendorId} className="bc-num">
                <span className="bc-best-v">{unitCost(b.bestCost)}</span>
                <span className="bc-sub">{BASIS_LABEL[b.bestCostBasis]}</span>
              </td>
            ))}
          </tr>

          <tr className="bc-save">
            <th scope="row" className="bc-rowhead">
              Saving vs baseline
              <span className="bc-sub">at full volume</span>
            </th>
            {cleanSheet ? <td className="bc-clean" /> : null}
            {bids.map((b) => {
              const per = baseline - b.bestCost;
              return (
                <td key={b.vendorId} className="bc-num">
                  <span className={per >= 0 ? "bc-pos" : "bc-neg"}>
                    {money(per * planUnits)}
                  </span>
                  <span className="bc-sub">{unitCost(Math.abs(per))}/unit</span>
                </td>
              );
            })}
          </tr>

          {/* Section 8 attributes. Never summed into FOB — but a cheaper vendor
              who cannot make the volume is not cheaper. */}
          <TermRow label="Capacity" bids={bids} cleanSheet={!!cleanSheet}
            pick={(b) => (b.maxVolumeCapacity ? `${units(b.maxVolumeCapacity)}/yr` : null)}
            warn={(b) => !!b.maxVolumeCapacity && b.maxVolumeCapacity < planUnits} />
          <TermRow label="Lead time" bids={bids} cleanSheet={!!cleanSheet}
            pick={(b) => (b.productionLeadTime ? `${b.productionLeadTime} days` : null)} />
          <TermRow label="MOQ" bids={bids} cleanSheet={!!cleanSheet}
            pick={(b) => (b.moq ? units(b.moq) : null)} />
        </tbody>
      </table>

      <p className="bc-note">
        ▲ marks a bucket above the clean sheet, our internal cost model — never
        shown to a vendor. Expand a bucket for the lines behind it.
      </p>
    </div>
  );
}

/**
 * A labelled group of line rows inside an expanded bucket.
 *
 * Money and non-money are formatted differently on purpose: `unitCost` on a
 * fabric width in metres would render "$1.50" and read as a cost.
 */
function LineGroup({
  label,
  lines,
  bids,
  cleanSheet,
  money: isMoney = false,
}: {
  label: string;
  lines: { key: string; label: string; unit?: string | null }[];
  bids: Bid[];
  cleanSheet: boolean;
  money?: boolean;
}) {
  return (
    <>
      <tr className="bc-group">
        <th scope="row" className="bc-rowhead">
          {label}
        </th>
        {cleanSheet ? <td className="bc-clean" /> : null}
        {bids.map((b) => (
          <td key={b.vendorId} className="bc-num" />
        ))}
      </tr>

      {lines.map((line) => (
        <tr className="bc-line-row" key={line.key}>
          <th scope="row" className="bc-rowhead">
            <span className="bc-line-label">{line.label}</span>
            {line.unit && line.unit !== "USD" ? (
              <span className="bc-line-unit">{line.unit}</span>
            ) : null}
          </th>
          {cleanSheet ? <td className="bc-clean" /> : null}
          {bids.map((b) => {
            const v = lineValue(b, line.key);
            return (
              <td key={b.vendorId} className="bc-num">
                {v === null ? (
                  <span className="bc-none">—</span>
                ) : typeof v === "number" ? (
                  isMoney ? (
                    unitCost(v)
                  ) : (
                    // Not money: show the number as given, trimmed.
                    Math.round(v * 1000) / 1000
                  )
                ) : (
                  <span className="bc-line-text" title={v}>
                    {v}
                  </span>
                )}
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}

/** One row of the cost chain. Null renders as an em dash, never as $0.00. */
function ChainRow({
  label,
  bids,
  pick,
  cleanSheet,
}: {
  label: string;
  bids: Bid[];
  pick: (b: Bid) => number | null;
  cleanSheet: boolean;
}) {
  return (
    <tr className="bc-chain">
      <th scope="row" className="bc-rowhead">
        {label}
      </th>
      {cleanSheet ? <td className="bc-clean" /> : null}
      {bids.map((b) => {
        const v = pick(b);
        return (
          <td key={b.vendorId} className="bc-num">
            {v === null ? <span className="bc-none">—</span> : unitCost(v)}
          </td>
        );
      })}
    </tr>
  );
}

function TermRow({
  label,
  bids,
  pick,
  warn,
  cleanSheet,
}: {
  label: string;
  bids: Bid[];
  pick: (b: Bid) => string | null;
  warn?: (b: Bid) => boolean;
  cleanSheet: boolean;
}) {
  return (
    <tr className="bc-term">
      <th scope="row" className="bc-rowhead">
        {label}
      </th>
      {cleanSheet ? <td className="bc-clean" /> : null}
      {bids.map((b) => {
        const v = pick(b);
        const isWarn = warn?.(b) ?? false;
        return (
          <td key={b.vendorId} className="bc-num">
            {v === null ? (
              <span className="bc-none">not given</span>
            ) : (
              <span className={isWarn ? "bc-warn" : undefined}>
                {v}
                {isWarn ? <Icon name="alert_triangle" size="sm" /> : null}
              </span>
            )}
          </td>
        );
      })}
    </tr>
  );
}
