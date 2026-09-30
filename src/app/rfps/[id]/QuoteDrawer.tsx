"use client";

import * as React from "react";
import { SideDrawer } from "@/components/SideDrawer";
import { Badge, Icon } from "@/ds/components";
import { useApi } from "@/lib/useApi";
import { unitCost, units } from "@/lib/format";

/**
 * A vendor's submitted bid, read-only, over the RFP.
 *
 * Mirrors the style detail drawer — hero image, identity, then the numbers —
 * because a bid IS a product view with a price on it, and two drawers that
 * show the same product should not look like different products.
 *
 * Comparison runs on BUCKET TOTALS; the line items behind each bucket are
 * drill-down evidence, so each bucket expands rather than listing everything
 * at once (Build Doc §10.2).
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

export function QuoteDrawer({
  invitationId,
  styleId,
  vendorName,
  onClose,
}: {
  invitationId: string | null;
  styleId: string | null;
  vendorName: string | null;
  onClose: () => void;
}) {
  const { data, loading } = useApi<QuoteDetail>(
    invitationId && styleId ? `/api/quotes/${invitationId}/${styleId}` : null,
  );
  const [open, setOpen] = React.useState<Set<string>>(new Set());

  React.useEffect(() => setOpen(new Set()), [styleId, invitationId]);

  const values = data?.quote?.values ?? {};

  function toggle(key: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /**
   * The STORED bucket total, not a re-derivation. Materials and Crafting come
   * through a formula (consumption x rate x wastage), so summing the raw money
   * lines under a section understates them — and two numbers for one bucket is
   * the class of bug this whole screen has been fixing.
   */
  function bucketTotal(sectionKey: string): number {
    return Number(data?.quote?.bucketTotals?.[sectionKey] ?? 0);
  }

  return (
    <SideDrawer
      open={invitationId !== null && styleId !== null}
      onClose={onClose}
      title={vendorName ?? "Bid"}
      sub={data ? `${data.style.styleNumber} · ${data.style.name}` : undefined}
    >
      {loading ? <div className="sk" style={{ blockSize: 240 }} /> : null}

      {data && !data.quote ? (
        <div className="empty compact">
          <span className="glyph">
            <Icon name="clock" size="lg" />
          </span>
          <div className="ttl">No bid yet</div>
          <div className="desc">
            {vendorName} has not submitted for this product.
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
            <div className="k">
              Their FOB <Badge tone="success">{data.quote.status}</Badge>
            </div>
            <div className="v">{unitCost(data.quote.fob)}</div>
          </div>

          <div className="section">
            <div className="hd">Product</div>
            <dl className="fact-list">
              <Row k="Style" v={data.style.styleNumber} />
              <Row k="Material" v={data.style.material ?? "—"} />
              {data.style.sizes.length ? (
                <Row k="Sizes" v={data.style.sizes.join(" · ")} />
              ) : null}
              <Row k="Plan units" v={`${units(data.style.planUnits)} / yr`} />
            </dl>
          </div>

          <div className="section">
            <div className="hd">Cost breakdown</div>
            {/* Each bucket expands to the lines behind it — the drill-down
                evidence, not the comparison itself. */}
            {data.template.definition.sections.map((section) => {
              const lines = section.lines.filter(
                (l) =>
                  !l.derived &&
                  values[l.key] !== undefined &&
                  values[l.key] !== "" &&
                  values[l.key] !== null,
              );
              if (!lines.length) return null;

              const isOpen = open.has(section.key);
              return (
                <div className="bid-bucket" key={section.key}>
                  <button
                    className="bid-bucket-head"
                    onClick={() => toggle(section.key)}
                    aria-expanded={isOpen}
                  >
                    <Icon
                      name={isOpen ? "chevron_up" : "chevron_down"}
                      size="sm"
                    />
                    <span className="bid-bucket-name">
                      {BUCKET_LABEL[section.key] ?? section.label}
                    </span>
                    <span className="bid-bucket-total">
                      {unitCost(bucketTotal(section.key))}
                    </span>
                  </button>

                  {isOpen ? (
                    <dl className="fact-list bid-bucket-lines">
                      {lines.map((line) => (
                        <Row
                          key={line.key}
                          k={line.label}
                          v={
                            line.unit === "USD"
                              ? unitCost(Number(values[line.key]))
                              : String(values[line.key])
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
    </SideDrawer>
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
