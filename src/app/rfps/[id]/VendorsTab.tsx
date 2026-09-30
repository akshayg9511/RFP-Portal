"use client";

import * as React from "react";
import { Badge, Checkbox, Icon } from "@/ds/components";
import { percent, unitCost } from "@/lib/format";
import type { Invitation, Style } from "./ProductsTab";

/**
 * Vendors ON this RFP, each expanding to their products.
 *
 * ONE list. It used to be two — "Added to this RFP" above "Not on this RFP",
 * each with its own inner scroll. Adding now opens a picker drawer, so this
 * list is only ever the vendors who are actually invited.
 *
 * Completion is a PERCENTAGE (§10.1), not "3 of 3 submitted". The fraction read
 * well at small counts but §10.1 asks for a percentage, and a bar makes a row
 * of vendors comparable at a glance.
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

export function VendorsTab({
  styles,
  invitations,
  candidates,
  picked,
  issued,
  onRemove,
  onToggleStyle,
  onAddVendors,
  onOpenBid,
}: {
  styles: Style[];
  invitations: Invitation[];
  candidates: Candidate[];
  /** vendorId -> the products they were given. Includes unsaved edits. */
  picked: Map<string, Set<string>>;
  issued: boolean;
  onRemove: (vendorId: string) => void;
  onToggleStyle: (vendorId: string, styleId: string) => void;
  onAddVendors: () => void;
  /** See the note in ProductsTab — A4 replaces this with a full page. */
  onOpenBid: (invitationId: string, styleId: string, vendorName: string) => void;
}) {
  const [query, setQuery] = React.useState("");
  const [region, setRegion] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [open, setOpen] = React.useState<Set<string>>(new Set());

  const byVendor = new Map(invitations.map((i) => [i.vendorId, i]));
  const infoFor = (vendorId: string) =>
    candidates.find((c) => c.id === vendorId);

  /** Submitted out of the products this vendor was actually given. */
  function completion(vendorId: string) {
    const subset = picked.get(vendorId) ?? new Set<string>();
    const quotes = byVendor.get(vendorId)?.quotes ?? [];
    const submitted = quotes.filter(
      (q) => q.status === "SUBMITTED" && subset.has(q.styleId),
    ).length;
    return {
      submitted,
      total: subset.size,
      share: subset.size ? submitted / subset.size : 0,
    };
  }

  const rows = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...picked.keys()]
      .map((vendorId) => ({ vendorId, info: infoFor(vendorId) }))
      .filter(({ vendorId, info }) => {
        if (!info) return false;
        if (region && info.cooRegion !== region) return false;
        if (status) {
          const c = completion(vendorId);
          if (status === "complete" && c.share < 1) return false;
          if (status === "partial" && !(c.share > 0 && c.share < 1)) return false;
          if (status === "none" && c.submitted > 0) return false;
        }
        if (
          q &&
          !info.name.toLowerCase().includes(q) &&
          !info.vendorCode.toLowerCase().includes(q)
        ) {
          return false;
        }
        return true;
      })
      .sort((a, b) => a.info!.name.localeCompare(b.info!.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked, candidates, query, region, status, invitations]);

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
            placeholder="Search vendors"
            aria-label="Search vendors on this RFP"
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
        <select
          className="control sm"
          aria-label="Filter by response"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">Any response</option>
          <option value="complete">Fully submitted</option>
          <option value="partial">Part submitted</option>
          <option value="none">Nothing yet</option>
        </select>

        {/* Adding opens a drawer. The second full-page list is gone. */}
        {!issued ? (
          /* Ghost: this sits in a UTILITY strip beside the filters, and the
             page's secondary is Save nominations. */
          <button className="btn btn--ghost btn--sm" onClick={onAddVendors}>
            <Icon name="plus" size="sm" />
            Add vendors
          </button>
        ) : null}

        <span className="aw-filter-count">
          {rows.length} of {picked.size} vendors
        </span>
      </div>

      {picked.size === 0 ? (
        <div className="empty compact">
          <span className="glyph">
            <Icon name="users" size="lg" />
          </span>
          <div className="ttl">No vendors yet</div>
          <div className="desc">
            Add the vendors who should quote these products.
          </div>
        </div>
      ) : rows.length === 0 ? (
        <div className="empty compact">
          <span className="glyph">
            <Icon name="search" size="lg" />
          </span>
          <div className="ttl">No vendor matches</div>
          <div className="desc">Try a different filter.</div>
        </div>
      ) : null}

      <div className="rd-list">
        {rows.map(({ vendorId, info }) => {
          const inv = byVendor.get(vendorId);
          const subset = picked.get(vendorId) ?? new Set<string>();
          const c = completion(vendorId);
          const isOpen = open.has(vendorId);

          return (
            <div className="rd-row" key={vendorId}>
              <button
                className="rd-head"
                onClick={() => toggle(vendorId)}
                aria-expanded={isOpen}
              >
                <Icon name={isOpen ? "chevron_up" : "chevron_down"} size="sm" />
                <span className="rd-id">
                  <span className="rd-name">
                    <span className="rd-title">{info!.name}</span>
                    {/* Neutral: type is a qualifier, not a state. */}
                    <span className="vl-type">
                      {info!.source === "INCUMBENT"
                        ? "Incumbent"
                        : info!.isNewToQuince
                          ? "New"
                          : "Existing"}
                    </span>
                  </span>
                  <span className="rd-meta">
                    <span className="id">{info!.vendorCode}</span>
                    {info!.cooRegion ? ` · ${info!.cooRegion}` : ""} ·{" "}
                    {subset.size} product{subset.size === 1 ? "" : "s"}
                  </span>
                  {/* §5.3 holds a product back when it is already quoted
                      elsewhere. Naming it is what makes "1 of 2" legible —
                      the silence there hid a save that was failing. */}
                  {info!.clashingStyleIds.length ? (
                    <span className="rd-held">
                      {info!.clashingStyleIds
                        .map(
                          (sid) =>
                            styles.find((st) => st.id === sid)?.styleNumber ??
                            "a product",
                        )
                        .join(", ")}{" "}
                      already quoted in another RFP
                    </span>
                  ) : null}
                </span>

                {issued ? (
                  <span className="rd-completion">
                    <span className="rd-bar">
                      <span style={{ inlineSize: percent(c.share, 0) }} />
                    </span>
                    <span className="rd-stat-k">
                      {percent(c.share, 0)} · {c.submitted} of {c.total}
                    </span>
                  </span>
                ) : (
                  /* ONE LINE. `.rd-stat` is a column flex, so "2" and "of 2"
                     rendered on separate lines. On a draft the denominator is
                     the choice being made, so it stays — but as a sentence. */
                  <span className="rd-count">
                    {subset.size} of {styles.length} product
                    {styles.length === 1 ? "" : "s"}
                  </span>
                )}

                <span className="rd-status">
                  {issued ? (
                    c.share === 1 && c.total > 0 ? (
                      <Badge tone="success">Submitted</Badge>
                    ) : c.submitted > 0 ? (
                      <Badge tone="warning">In progress</Badge>
                    ) : (
                      <Badge tone="info">Pending</Badge>
                    )
                  ) : null}
                </span>
              </button>

              {isOpen ? (
                <div className="rd-body">
                  {/* Issued: only what this vendor was given. Draft: every
                      product, because the list is the picker. */}
                  {(issued
                    ? styles.filter((s) => subset.has(s.id))
                    : styles
                  ).map((style) => {
                    const quote = inv?.quotes.find(
                      (q) => q.styleId === style.id,
                    );
                    const inSubset = subset.has(style.id);

                    return (
                      <div className="rd-bid" key={style.id}>
                        {!issued ? (
                          <Checkbox
                            checked={inSubset}
                            onChange={() => onToggleStyle(vendorId, style.id)}
                            aria-label={`${style.name} for ${info!.name}`}
                          />
                        ) : null}
                        <span className="rd-bid-vendor">
                          <span className="id">{style.styleNumber}</span>
                          <span className="rd-bid-meta">{style.name}</span>
                        </span>

                        {inSubset && quote?.status === "SUBMITTED" ? (
                          <button
                            className="btn btn--ghost btn--sm"
                            onClick={() =>
                              onOpenBid(inv!.id, style.id, info!.name)
                            }
                          >
                            {unitCost(quote.fob)}
                            <Icon name="arrow_right" size="sm" />
                          </button>
                        ) : inSubset && issued ? (
                          <span className="rd-pending">Not submitted</span>
                        ) : null}
                      </div>
                    );
                  })}

                  {!issued ? (
                    <button
                      className="btn btn--ghost btn--sm rd-compare"
                      onClick={() => onRemove(vendorId)}
                    >
                      Remove {info!.name} from this RFP
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </>
  );
}
