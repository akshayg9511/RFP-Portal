"use client";

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
};

export function StyleCard({
  style,
  selected,
  onToggle,
  onOpen,
}: {
  style: StyleSummary;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
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
    </div>
  );
}
