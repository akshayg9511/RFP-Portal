"use client";

import * as React from "react";
import { Checkbox } from "@/ds/components";
import { unitCost, units } from "@/lib/format";

export type StyleSummary = {
  id: string;
  styleNumber: string;
  name: string;
  division: string;
  department: string;
  subDepartment: string;
  material: string | null;
  variationLevel: string;
  heroImage: string | null;
  planUnits: number | null;
  baselineFob: number | null;
  annualSpend: number;
  colourwayCount: number;
  skuCount: number;
  bidCount: number;
  /**
   * Which variations this set admits. EMPTY = the whole product.
   * Present only on the set-detail read; the catalog does not send it.
   */
  memberVariationIds?: string[];
};

export function StyleCard({
  style,
  selected,
  onToggle,
  onOpen,
  variations,
}: {
  style: StyleSummary;
  /**
   * Every variation the PRODUCT has, so the ones the set excludes can be
   * shown greyed rather than simply absent — "which sizes did we leave out"
   * is a question the set page should answer.
   */
  variations?: {
    id: string;
    label: string;
    planUnits?: number;
    baselineFob?: number | null;
  }[];
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  // The card shows the PRODUCT. Variation figures are deliberately not
  // switchable here: the set page's job is selecting products, and variation
  // editing happens in the review modal at RFP time. The chips below still
  // say which variations the set left out, which is the one variation fact
  // worth seeing at a glance.

  return (
    <div className={selected ? "card raised style-card on" : "card raised style-card"}>
      <div
        className="style-card-select"
        // The checkbox sits over the image; stop the click from also opening
        // the drawer.
        onClick={(event) => event.stopPropagation()}
      >
        <Checkbox
          checked={selected}
          onChange={onToggle}
          aria-label={`Select ${style.name}`}
        />
      </div>

      <button
        onClick={onOpen}
        style={{
          appearance: "none",
          border: 0,
          padding: 0,
          background: "none",
          cursor: "pointer",
          textAlign: "start",
          inlineSize: "100%",
        }}
        aria-label={`Open ${style.name}`}
      >
        <div className="style-card-media">
          {style.heroImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={style.heroImage} alt="" loading="lazy" />
          ) : (
            <div className="thumb blank" />
          )}
        </div>

        <div className="card-b">
          <span className="num">{style.styleNumber}</span>
          <span className="nm">{style.name}</span>
          <div className="meta">
            <span>{units(style.planUnits)} units</span>
            <span>{unitCost(style.baselineFob)}</span>
          </div>
        </div>
      </button>

      {variations?.length ? (
        <VariationChips
          variations={variations}
          included={style.memberVariationIds ?? []}
        />
      ) : null}
    </div>
  );
}

/**
 * The set's variation membership, inside the card.
 *
 * A capped scroll region rather than an expanding section: these cards sit in
 * a CSS grid, and a card that grows on expand stretches its whole row. With
 * the 4-5 variation cap the list rarely scrolls at all.
 *
 * Excluded variations are GREYED, not omitted — the useful question here is
 * "which sizes did we leave out", and an absent row cannot answer it.
 */
function VariationChips({
  variations,
  included,
}: {
  variations: { id: string; label: string }[];
  included: string[];
}) {
  // An empty membership list means the whole product is in, so everything
  // reads as included.
  const wholeProduct = included.length === 0;
  const inSet = new Set(included);

  return (
    <div className="sc-vars">
      {variations.map((v) => {
        const isIn = wholeProduct || inSet.has(v.id);
        return (
          <span
            key={v.id}
            className={isIn ? "sc-var" : "sc-var is-out"}
            title={isIn ? undefined : "Not part of this style set"}
          >
            {v.label}
          </span>
        );
      })}
    </div>
  );
}
