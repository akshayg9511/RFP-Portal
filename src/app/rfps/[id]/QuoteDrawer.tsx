"use client";

import * as React from "react";
import { SideDrawer } from "@/components/SideDrawer";
import { BidTabs, type BidTab } from "@/components/BidTabs";
import { Icon } from "@/ds/components";
import { useApi } from "@/lib/useApi";
import { unitCost, units } from "@/lib/format";

/**
 * One vendor's bid on one product, over the RFP.
 *
 * UX v2 layout (Aravind C16–C18, walkthrough 8 Oct, decision D2):
 *   status badge + ⓘ lifecycle tooltip, and "Move ▾" at the top right
 *   → a message bar carrying the latest note, dismissible, with View
 *   → two tabs: Bid details · Comments (n). No Activity tab for now (D3).
 *
 * The cost breakdown is unchanged: bucket totals, each expanding to the
 * lines behind it (Build Doc §10.2).
 */

type Line = {
  key: string;
  label: string;
  unit?: string;
  derived?: boolean;
  inputType?: string;
};

type QuoteDetail = {
  style: {
    styleNumber: string;
    name: string;
    material: string | null;
    planUnits: number | null;
    heroImage: string | null;
    sizes: string[];
  };
  template: {
    definition: { sections: { key: string; label: string; lines: Line[] }[] };
  };
  quote: {
    status: string;
    values: Record<string, number | string | null>;
    bucketTotals: Record<string, number> | null;
    fob: number | null;
  } | null;
};


const BUCKET_LABEL: Record<string, string> = {
  BASE_MATERIALS: "Materials",
  TRIM_HARDWARE: "Trim + hardware",
  PACKAGING: "Packaging",
  CRAFTING: "Crafting",
  OVERHEAD_SGA_PROFIT: "Overhead + SG&A",
};

export type DrawerTab = BidTab;

export function QuoteDrawer({
  invitationId,
  styleId,
  vendorName,
  initialTab = "details",
  onClose,
  onChanged,
}: {
  invitationId: string | null;
  styleId: string | null;
  vendorName: string | null;
  initialTab?: DrawerTab;
  onClose: () => void;
  /** A move or a message changed the bid — the page refreshes its rows. */
  onChanged?: () => void;
}) {
  const key = invitationId && styleId ? `${invitationId}/${styleId}` : null;
  const { data, loading } = useApi<QuoteDetail>(key ? `/api/quotes/${key}` : null);

  return (
    <SideDrawer
      open={key !== null}
      onClose={onClose}
      title={vendorName ?? "Bid"}
      sub={data ? `${data.style.styleNumber} · ${data.style.name}` : undefined}
    >
      {/* Keyed by bid, so tab, open buckets and a dismissed bar reset when
          the drawer moves to another bid — no effect needed. */}
      {key ? (
        <DrawerContent
          key={`${key}:${initialTab}`}
          invitationId={invitationId!}
          styleId={styleId!}
          vendorName={vendorName}
          initialTab={initialTab}
          data={data}
          loading={loading}
          onChanged={onChanged}
        />
      ) : null}
    </SideDrawer>
  );
}

function DrawerContent({
  invitationId,
  styleId,
  vendorName,
  initialTab,
  data,
  loading,
  onChanged,
}: {
  invitationId: string;
  styleId: string;
  vendorName: string | null;
  initialTab: DrawerTab;
  data: QuoteDetail | null | undefined;
  loading: boolean;
  onChanged?: () => void;
}) {
  // EVERYTHING, open by default (Akshay, 8 Oct: "show all the cost
  // breakdowns"). A bucket can still be folded away; `closed` holds those.
  const [closed, setClosed] = React.useState<Set<string>>(new Set());
  const values = data?.quote?.values ?? {};

  function toggle(sectionKey: string) {
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(sectionKey)) next.delete(sectionKey);
      else next.add(sectionKey);
      return next;
    });
  }

  return (
    <BidTabs invitationId={invitationId} styleId={styleId} initialTab={initialTab} onChanged={onChanged}>
      {loading ? <div className="sk" style={{ blockSize: 240 }} /> : null}

      {data && !data.quote ? (
        <div className="empty compact">
          <span className="glyph">
            <Icon name="clock" size="lg" />
          </span>
          <div className="ttl">No bid yet</div>
          <div className="desc">
            {vendorName} has not submitted for this style. You can still
            message them from Comments.
          </div>
        </div>
      ) : null}

      {data?.quote ? (
        <>
          {data.style.heroImage ? (
            <div className="detail-hero">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={data.style.heroImage} alt={data.style.name} />
            </div>
          ) : null}

          <div className="quote-total" style={{ marginBlockStart: "var(--space-lg)" }}>
            <div className="k">Their FOB</div>
            <div className="v">{unitCost(data.quote.fob)}</div>
          </div>

          <div className="section">
            <div className="hd">Style</div>
            <dl className="fact-list">
              <Row k="Style" v={data.style.styleNumber} />
              <Row k="Material" v={data.style.material ?? "—"} />
              {data.style.sizes.length ? <Row k="Sizes" v={data.style.sizes.join(" · ")} /> : null}
              <Row k="Plan units" v={`${units(data.style.planUnits)} / yr`} />
            </dl>
          </div>

          <div className="section">
            <div className="hd">Cost breakdown</div>
            {data.template.definition.sections.map((section) => {
              // Every line of every bucket — blanks read "—" rather than
              // vanishing, so the reader can see what the vendor left empty.
              const lines = section.lines;
              const isOpen = !closed.has(section.key);
              const total = Number(data.quote?.bucketTotals?.[section.key] ?? 0);
              return (
                <div className="bid-bucket" key={section.key}>
                  <button
                    className="bid-bucket-head"
                    onClick={() => toggle(section.key)}
                    aria-expanded={isOpen}
                  >
                    <Icon name={isOpen ? "chevron_up" : "chevron_down"} size="sm" />
                    <span className="bid-bucket-name">{BUCKET_LABEL[section.key] ?? section.label}</span>
                    <span className="bid-bucket-total">{unitCost(total)}</span>
                  </button>
                  {isOpen ? (
                    <dl className="fact-list bid-bucket-lines">
                      {lines.map((line) => (
                        <Row
                          key={line.key}
                          k={line.label}
                          v={
                            values[line.key] === undefined || values[line.key] === null || values[line.key] === ""
                              ? "—"
                              : line.unit === "USD"
                                ? unitCost(Number(values[line.key]))
                                : `${values[line.key]}${line.unit && line.unit !== "USD" ? ` ${line.unit}` : ""}`
                          }
                        />
                      ))}
                    </dl>
                  ) : null}
                </div>
              );
            })}
          </div>
        </>
      ) : null}
    </BidTabs>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </>
  );
}
