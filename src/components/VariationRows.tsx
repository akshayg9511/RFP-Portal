"use client";

import * as React from "react";
import { Checkbox } from "@/ds/components";
import { money, units } from "@/lib/format";
import type { SelectedStyle } from "@/lib/selection";

/**
 * The variation rows revealed under an expanded product.
 *
 * Rendered as SIBLING `<tr>`s inside the product's own table, not a nested
 * table in a `colSpan` cell: siblings inherit the `<colgroup>`, so the
 * variation figures stay under the columns they belong to. A nested table
 * would align to itself and read as a different grid.
 *
 * Fetches on first expand. Folding variations into `GET /api/styles` would
 * ship every SKU of all 82 products on every catalog render for the handful
 * of rows anyone opens.
 */

export type VariationGroup = {
  key: string;
  label: string;
  variationIds: string[];
  skuCount: number;
  planUnits: number;
  revenue: number;
  baselineFobLow: number | null;
  baselineFobHigh: number | null;
};

type Payload = { styleId: string; grain: string; groups: VariationGroup[] };

/** Cached across expand/collapse so reopening a row costs nothing. */
const cache = new Map<string, VariationGroup[]>();

export function useVariationGroups(styleId: string, open: boolean) {
  const [groups, setGroups] = React.useState<VariationGroup[] | null>(
    () => cache.get(styleId) ?? null,
  );

  React.useEffect(() => {
    if (!open || groups) return;
    let cancelled = false;
    fetch(`/api/styles/${styleId}/variations`)
      .then((r) => r.json())
      .then((body: Payload) => {
        if (cancelled) return;
        cache.set(styleId, body.groups);
        setGroups(body.groups);
      })
      .catch(() => {
        // An empty group list renders "no variations" rather than spinning
        // forever, which is the honest end state for a failed fetch.
        if (!cancelled) setGroups([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, styleId, groups]);

  // DERIVED, not a second piece of state. A `loading` flag set synchronously
  // in the effect cascades renders (and the lint rule says so); "open but
  // nothing arrived yet" is exactly the same information.
  return { groups, loading: open && !groups };
}

export function VariationRows({
  style,
  groups,
  loading,
  selectedIds,
  onToggle,
  columns,
}: {
  style: SelectedStyle;
  groups: VariationGroup[] | null;
  loading: boolean;
  selectedIds: string[];
  onToggle: (
    style: SelectedStyle,
    variationId: string,
    variationTotal?: number,
  ) => void;
  /** Total columns in the host table, so a message can span the row. */
  columns: number;
}) {
  if (loading && !groups) {
    return (
      <tr className="pc-var-row">
        <td colSpan={columns}>
          <div className="sk" style={{ blockSize: 22 }} />
        </td>
      </tr>
    );
  }

  if (!groups?.length) {
    return (
      <tr className="pc-var-row">
        <td colSpan={columns}>
          <span className="pc-var-none">No variations on this product.</span>
        </td>
      </tr>
    );
  }

  const picked = new Set(selectedIds);
  // The product's TOTAL variation count, so a partial selection can be
  // detected however the user got there — one row at a time or all at once.
  const total = groups.reduce((t, g) => t + g.variationIds.length, 0);

  return (
    <>
      {groups.map((group) => {
        // A group is ticked when every variation inside it is. Groups roll up
        // several SKUs at COLOUR or SIZE grain, so "some in" is possible.
        const inside = group.variationIds.filter((id) => picked.has(id));
        const all = inside.length === group.variationIds.length;
        const some = inside.length > 0 && !all;

        return (
          <tr className="pc-var-row" key={group.key}>
            <td>
              <span className="pc-var-box">
                <Checkbox
                  checked={all}
                  mixed={some}
                  onChange={() => {
                    // Toggle the whole group: at SIZE grain one row can hold
                    // several colour SKUs, and the row is the unit the user
                    // is choosing.
                    for (const id of group.variationIds) {
                      const isIn = picked.has(id);
                      if (all ? isIn : !isIn) onToggle(style, id, total);
                    }
                  }}
                  aria-label={`Select ${group.label} of ${style.name}`}
                />
              </span>
            </td>
            <td>
              <span className="pc-var-label">
                {group.label}
                <span className="pc-var-meta">
                  {group.skuCount} SKU{group.skuCount === 1 ? "" : "s"}
                </span>
              </span>
            </td>
            {/* One cell per host column, so every figure sits under its own
                header and the row spans the whole table (Aravind, C5). It
                used to be one cell short: plan units landed under Bid grain
                and the row's fill stopped before the last column. */}
            <td />
            <td />
            <td className="num">{units(group.planUnits)}</td>
            <td className="num">
              {money(group.revenue)}
              <span className="pc-var-meta">
                {group.baselineFobLow === null
                  ? ""
                  : group.baselineFobLow === group.baselineFobHigh
                    ? `@ ${money(group.baselineFobLow)}`
                    : `@ ${money(group.baselineFobLow)}–${money(group.baselineFobHigh!)}`}
              </span>
            </td>
            <td className="num">
              {group.baselineFobLow !== null && group.baselineFobLow === group.baselineFobHigh
                ? money(group.planUnits * group.baselineFobLow)
                : "—"}
            </td>
            <td />
          </tr>
        );
      })}
    </>
  );
}
