"use client";

import * as React from "react";
import { SideDrawer } from "@/components/SideDrawer";
import { Icon } from "@/ds/components";

/**
 * Add vendors to an RFP, from a drawer.
 *
 * Replaces a second full-page list. The page used to stack "Added to this RFP"
 * (15 rows, own scroll) on top of "Not on this RFP" (23 rows, own scroll) —
 * nested scroll traps, the added list visibly cut mid-row, and on an ISSUED RFP
 * 23 rows of addable vendors that could not be added anyway.
 *
 * The page now shows only vendors ON the RFP. Adding is a deliberate act that
 * opens this.
 */

export type Candidate = {
  id: string;
  vendorCode: string;
  name: string;
  countryIso: string | null;
  cooRegion: string | null;
  isNewToQuince: boolean;
  source: "INCUMBENT" | "SEARCH";
  clashingStyleIds: string[];
};

const REGIONS = ["CHINA", "SEA", "ISC", "AMERICAS", "EMEA"];

export function VendorPicker({
  open,
  onClose,
  candidates,
  onAdd,
  onNewVendor,
}: {
  open: boolean;
  onClose: () => void;
  /** Only vendors NOT already on the RFP. */
  candidates: Candidate[];
  onAdd: (vendorIds: string[]) => void;
  onNewVendor: () => void;
}) {
  const [query, setQuery] = React.useState("");
  const [region, setRegion] = React.useState("");
  const [checked, setChecked] = React.useState<Set<string>>(new Set());

  const rows = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return candidates
      .filter((c) => {
        if (region && c.cooRegion !== region) return false;
        if (
          q &&
          !c.name.toLowerCase().includes(q) &&
          !c.vendorCode.toLowerCase().includes(q)
        ) {
          return false;
        }
        return true;
      })
      // Incumbents first — they make the product today, so theirs is the price
      // to beat (§5.3 offers them first).
      .sort((a, b) => {
        if ((a.source === "INCUMBENT") !== (b.source === "INCUMBENT")) {
          return a.source === "INCUMBENT" ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });
  }, [candidates, query, region]);

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <SideDrawer
      open={open}
      onClose={onClose}
      title="Add vendors"
      sub={`${candidates.length} not yet on this RFP`}
      footer={
        <div className="pg-footer">
          <div className="pg-footer-state">
            {checked.size
              ? `${checked.size} selected`
              : "Pick the vendors to invite"}
          </div>
          <button className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn--primary"
            disabled={checked.size === 0}
            onClick={() => {
              onAdd([...checked]);
              setChecked(new Set());
              onClose();
            }}
          >
            Add {checked.size || ""}
          </button>
        </div>
      }
    >
      <div className="aw-filters">
        <div className="control search sm aw-search">
          <Icon name="search" size="sm" />
          <input
            placeholder="Search vendors"
            aria-label="Search vendors by name or code"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select
          className="control sm"
          aria-label="Filter by region"
          value={region}
          onChange={(e) => setRegion(e.target.value)}
        >
          <option value="">All regions</option>
          {REGIONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <button className="btn btn--ghost sm" onClick={onNewVendor}>
          <Icon name="plus" size="sm" />
          New vendor
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="empty compact">
          <span className="glyph">
            <Icon name="search" size="lg" />
          </span>
          <div className="ttl">
            {candidates.length ? "No vendor matches" : "Every vendor is on this RFP"}
          </div>
          <div className="desc">
            {candidates.length
              ? "Try a different search, or add a new vendor."
              : "Add a new vendor if you need someone else."}
          </div>
        </div>
      ) : null}

      <div className="vp-list">
        {rows.map((c) => (
          <label className="vp-row" key={c.id}>
            <input
              type="checkbox"
              checked={checked.has(c.id)}
              onChange={() => toggle(c.id)}
              aria-label={`Add ${c.name}`}
            />
            <span className="vp-id">
              <span className="vp-name">
                {c.name}
                <span className="vl-type">
                  {c.source === "INCUMBENT"
                    ? "Incumbent"
                    : c.isNewToQuince
                      ? "New"
                      : "Existing"}
                </span>
              </span>
              <span className="vp-meta">
                <span className="id">{c.vendorCode}</span>
                {c.cooRegion ? ` · ${c.cooRegion}` : ""}
              </span>
            </span>

            {/* A clash is per PRODUCT (§5.3), not per vendor — adding takes the
                products they can legally have and holds back the rest. */}
            {c.clashingStyleIds.length ? (
              <span className="vp-note">
                {c.clashingStyleIds.length} held back
              </span>
            ) : null}
          </label>
        ))}
      </div>
    </SideDrawer>
  );
}
