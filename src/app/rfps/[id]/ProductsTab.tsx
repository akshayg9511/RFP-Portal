"use client";

import * as React from "react";
import { Icon } from "@/ds/components";
import { money, unitCost, units } from "@/lib/format";

/**
 * The RFP's products, each expanding to the vendors that bid it.
 *
 * Products used to sit at the BOTTOM of this page, below 38 vendor rows — the
 * RFP's actual subject was the last thing you reached. And the only bid signal
 * anywhere was "1 of 1 submitted", a count, so no price was visible without
 * expanding a vendor.
 *
 * Rows expand in place because that is what makes the tabs work: this tab
 * answers "which vendors bid this product" and the Vendors tab answers "which
 * products did this vendor quote", so neither question needs a tab switch.
 */

export type Style = {
  id: string;
  styleNumber: string;
  name: string;
  subDepartment: string;
  heroImage: string | null;
  planUnits: number | null;
  baselineFob: number | null;
  /** EVERY variation the product has — the set to nominate FROM. */
  variations?: { id: string; label: string; baselineFob?: number | null }[];
  /** Which of them are ON this RFP. EMPTY = the whole product. */
  onRfp?: { id: string; label: string }[];
};

export type Invitation = {
  id: string;
  vendorId: string;
  vendorName: string;
  vendorCode: string;
  cooRegion: string | null;
  styleIds: string[];
  quotes: { styleId: string; status: string; fob: number | null }[];
};

export function ProductsTab({
  styles,
  invitations,
  onOpenBid,
}: {
  styles: Style[];
  invitations: Invitation[];
  /**
   * Opens the read-only bid drawer. A per-product page comparing every vendor
   * side by side is A4; until it exists a bid opens what we already have,
   * because a dead link is worse than an interim destination.
   */
  onOpenBid: (invitationId: string, styleId: string, vendorName: string) => void;
}) {
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState<Set<string>>(new Set());

  const rows = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return styles;
    return styles.filter(
      (s) =>
        s.styleNumber.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q),
    );
  }, [styles, query]);

  /** Every submitted bid on a style, cheapest first. */
  function bidsFor(styleId: string) {
    return invitations
      .flatMap((inv) => {
        const quote = inv.quotes.find(
          (q) => q.styleId === styleId && q.status === "SUBMITTED",
        );
        return quote && quote.fob !== null
          ? [{ inv, fob: quote.fob }]
          : [];
      })
      .sort((a, b) => a.fob - b.fob);
  }

  /** Invited but not yet submitted — the chase list. */
  function pendingFor(styleId: string) {
    return invitations.filter(
      (inv) =>
        inv.styleIds.includes(styleId) &&
        !inv.quotes.some(
          (q) => q.styleId === styleId && q.status === "SUBMITTED",
        ),
    );
  }

  function toggle(id: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <>
      <div className="aw-filters">
        <div className="control search sm aw-search">
          <Icon name="search" size="sm" />
          <input
            placeholder="Search products"
            aria-label="Search products in this RFP"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <span className="aw-filter-count">
          {rows.length} of {styles.length} products
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="empty compact">
          <span className="glyph">
            <Icon name="search" size="lg" />
          </span>
          <div className="ttl">No product matches</div>
          <div className="desc">Try a different search.</div>
        </div>
      ) : null}

      <div className="rd-list">
        {rows.map((style) => {
          const bids = bidsFor(style.id);
          const pending = pendingFor(style.id);
          const isOpen = open.has(style.id);
          const invited = invitations.filter((i) =>
            i.styleIds.includes(style.id),
          ).length;

          return (
            <div className="rd-row" key={style.id}>
              <button
                className="rd-head"
                onClick={() => toggle(style.id)}
                aria-expanded={isOpen}
              >
                <Icon
                  name={isOpen ? "chevron_up" : "chevron_down"}
                  size="sm"
                />
                {style.heroImage ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img className="aw-thumb" src={style.heroImage} alt="" loading="lazy" />
                ) : (
                  <span className="aw-thumb aw-thumb--empty" />
                )}
                <span className="rd-id">
                  <span className="rd-name">
                    <span className="id">{style.styleNumber}</span>
                    <span className="rd-title">{style.name}</span>
                  </span>
                  <span className="rd-meta">
                    {style.subDepartment} · {units(style.planUnits)} units/yr ·
                    baseline {unitCost(style.baselineFob)}
                    {style.onRfp?.length
                      ? ` · ${style.onRfp.length} out to bid`
                      : ""}
                  </span>
                </span>

                <span className="rd-stat">
                  {bids.length ? (
                    <>
                      <span className="rd-stat-v">{unitCost(bids[0].fob)}</span>
                      <span className="rd-stat-k">
                        lowest of {bids.length}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="rd-stat-v rd-none">—</span>
                      <span className="rd-stat-k">
                        {invited ? `${invited} invited` : "no vendors"}
                      </span>
                    </>
                  )}
                </span>
              </button>

              {isOpen ? (
                <div className="rd-body">
                  {/* WHICH variations went out. Shown here because the
                      Products tab answers "what is in this RFP" — the bids
                      themselves are the Vendors tab's job. */}
                  {style.onRfp?.length ? (
                    <div className="rd-var-strip">
                      {style.onRfp.map((v) => (
                        <span className="sc-var" key={v.id}>
                          {v.label}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  {bids.length === 0 && pending.length === 0 ? (
                    <p className="rd-empty">No vendor has this product yet.</p>
                  ) : null}

                  {bids.map(({ inv, fob }) => (
                    <div className="rd-bid" key={inv.id}>
                      <span className="rd-bid-vendor">
                        {inv.vendorName}
                        <span className="rd-bid-meta">
                          <span className="id">{inv.vendorCode}</span>
                          {inv.cooRegion ? ` · ${inv.cooRegion}` : ""}
                        </span>
                      </span>
                      {/* One destination for "see the complete bid" — the
                          product with every vendor side by side. */}
                      <button
                        className="btn btn--ghost btn--sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenBid(inv.id, style.id, inv.vendorName);
                        }}
                      >
                        {unitCost(fob)}
                        <Icon name="arrow_right" size="sm" />
                      </button>
                    </div>
                  ))}

                  {pending.map((inv) => (
                    <div className="rd-bid is-pending" key={inv.id}>
                      <span className="rd-bid-vendor">
                        {inv.vendorName}
                        <span className="rd-bid-meta">
                          <span className="id">{inv.vendorCode}</span>
                          {inv.cooRegion ? ` · ${inv.cooRegion}` : ""}
                        </span>
                      </span>
                      <span className="rd-pending">Not submitted</span>
                    </div>
                  ))}

                  {bids.length > 1 ? (
                    <span className="rd-soon">
                      A per-product page comparing all {bids.length} bids side
                      by side is the next build (A4).
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {styles.length > 0 ? (
        <p className="rd-foot">
          Total baseline{" "}
          {money(
            styles.reduce(
              (sum, s) => sum + (s.planUnits ?? 0) * (s.baselineFob ?? 0),
              0,
            ),
          )}{" "}
          across {styles.length} products.
        </p>
      ) : null}
    </>
  );
}
