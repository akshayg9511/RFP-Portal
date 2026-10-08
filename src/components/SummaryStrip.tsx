import * as React from "react";

/**
 * The headline figures under a page title, as plain flat cards of equal width
 * that together span the content (Aravind, C3 / C40 / C47: "These need to be
 * plain flat cards that span the breadth of the screen"). No colour on the
 * cards — the walkthrough was explicit — so a figure's meaning is carried by
 * its label, not its fill.
 */
export function SummaryStrip({
  items,
}: {
  items: { label: string; value: React.ReactNode; sub?: React.ReactNode }[];
}) {
  return (
    <div className="sum-strip" role="list">
      {items.map((it) => (
        <div className="card sum-card" role="listitem" key={it.label}>
          <span className="k">{it.label}</span>
          <span className="v">{it.value}</span>
          {it.sub ? <span className="s">{it.sub}</span> : null}
        </div>
      ))}
    </div>
  );
}
