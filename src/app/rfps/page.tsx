"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Badge, Icon } from "@/ds/components";
import { useApi } from "@/lib/useApi";
import { percent, units } from "@/lib/format";
import { facetsOf } from "@/components/FacetSelect";
import { FilterBar } from "@/components/FilterBar";
import { SortTh, sortRows, type SortState } from "@/components/SortTh";
import * as React from "react";

type RfpRow = {
  id: string;
  name: string;
  status: string;
  templateName: string;
  waveName: string;
  dueDate: string | null;
  styleCount: number;
  vendorCount: number;
  respondedCount: number;
  bidCount: number;
  stylesWithBids: number;
  /** Lowest bid vs baseline across products that have bids. Negative saves. */
  lowestVsBaseline: number | null;
  sourcingPartner: string | null;
  gm: string | null;
  /** Owners as lists (ux/rfp-2). Absent on older API responses. */
  sourcingPartners?: string[];
  gms?: string[];
  procurementOwners?: string[];
};

/**
 * DRAFT used to render with `tone: undefined`, which gives a Badge no fill —
 * so it read as plain text beside a filled ISSUED chip and looked like a
 * different kind of thing. Every state now carries a tone.
 */
const STATUS_TONE: Record<string, "success" | "info" | "warning" | undefined> = {
  DRAFT: "warning",
  ISSUED: "success",
  CLOSED: "info",
};

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  ISSUED: "Issued",
  CLOSED: "Closed",
};

/**
 * Status sorts by STATE, not spelling: done → on track → needs work, so a
 * descending sort gathers the drafts that still need finishing at the top.
 */
const STATUS_RANK: Record<string, number> = { CLOSED: 0, ISSUED: 1, DRAFT: 2 };

type SortKey = "name" | "status" | "products" | "vendors" | "bids" | "lowest";

function partnersOf(r: RfpRow): string[] {
  if (r.sourcingPartners?.length) return r.sourcingPartners;
  return r.sourcingPartner ? [r.sourcingPartner] : [];
}

function gmsOf(r: RfpRow): string[] {
  if (r.gms?.length) return r.gms;
  return r.gm ? [r.gm] : [];
}

export default function RfpsPage() {
  // useSearchParams() needs a Suspense boundary to prerender (A17).
  return (
    <React.Suspense fallback={<div className="sk" style={{ blockSize: 320 }} />}>
      <RfpsList />
    </React.Suspense>
  );
}

function RfpsList() {
  const { data, loading, error } = useApi<RfpRow[]>("/api/rfps");

  /**
   * Arriving from Create with several drafts (one per quotation template):
   * say so, and mark them, so the buyer can complete each one in turn.
   */
  const params = useSearchParams();
  const createdIds = React.useMemo(
    () => new Set((params.get("created") ?? "").split(",").filter(Boolean)),
    [params],
  );
  const notice = params.get("notice");
  const [bannerOpen, setBannerOpen] = React.useState(true);

  /**
   * FILTER & SORT (Aravind, C13). Search, ONE facet (Status), and More
   * filters for Sourcing partner and GM — the owner filters Akshay asked for
   * in H5, kept, but behind one trigger so the bar reads as a sentence
   * rather than a rank of selects. Sort lives in the column headers.
   */
  const [query, setQuery] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [more, setMore] = React.useState<{ partner: string[]; gm: string[]; procurement: string[] }>({
    partner: [],
    gm: [],
    procurement: [],
  });
  const [sort, setSort] = React.useState<SortState<SortKey>>(null);

  const matches = React.useCallback(
    (r: RfpRow, skip?: "status" | "partner" | "gm" | "procurement") => {
      const q = query.trim().toLowerCase();
      if (q && !`${r.name} ${r.templateName}`.toLowerCase().includes(q)) return false;
      if (skip !== "status" && status && r.status !== status) return false;
      if (
        skip !== "partner" &&
        more.partner.length &&
        !partnersOf(r).some((p) => more.partner.includes(p))
      ) {
        return false;
      }
      if (skip !== "gm" && more.gm.length && !gmsOf(r).some((g) => more.gm.includes(g))) {
        return false;
      }
      if (
        skip !== "procurement" &&
        more.procurement.length &&
        !(r.procurementOwners ?? []).some((o) => more.procurement.includes(o))
      ) {
        return false;
      }
      return true;
    },
    [query, status, more],
  );

  const rows = React.useMemo(
    () =>
      sortRows((data ?? []).filter((r) => matches(r)), sort, (r, key) => {
        switch (key) {
          case "name":
            return r.name.toLowerCase();
          case "status":
            return STATUS_RANK[r.status] ?? 9;
          case "products":
            return r.styleCount;
          case "vendors":
            return r.vendorCount;
          case "bids":
            return r.bidCount;
          case "lowest":
            return r.lowestVsBaseline;
        }
      }),
    [data, matches, sort],
  );

  /**
   * Facet counts EXCLUDE their own dimension, so picking one partner does
   * not make every other partner read (0) — you could then never see what
   * switching to them would give you. Same rule as /award.
   */
  const facets = React.useMemo(() => {
    const all = data ?? [];
    return {
      status: facetsOf(all.filter((r) => matches(r, "status")), (r) => r.status),
      partner: facetsOf(all.filter((r) => matches(r, "partner")), partnersOf),
      gm: facetsOf(all.filter((r) => matches(r, "gm")), gmsOf),
      procurement: facetsOf(all.filter((r) => matches(r, "procurement")), (r) => r.procurementOwners ?? []),
    };
  }, [data, matches]);

  const filtered = Boolean(
    query || status || more.partner.length || more.gm.length || more.procurement.length,
  );

  function clearFilters() {
    setQuery("");
    setStatus("");
    setMore({ partner: [], gm: [], procurement: [] });
  }

  return (
    <>
      {/* The primary sits on the title's line, trailing (Aravind, C11). */}
      <div className="page-hd">
        <div className="row">
          <div className="grow">
            <h1 className="ttl">RFPs</h1>
          </div>
          <div className="acts">
            <Link className="btn btn--primary" href="/style-sets">
              <Icon name="plus" />
              New RFP
            </Link>
          </div>
        </div>
      </div>

      {createdIds.size && bannerOpen ? (
        <div className="bar bar--info rl-created">
          <Icon name="info_circle" />
          <div>
            <strong>
              {createdIds.size} draft RFP{createdIds.size === 1 ? "" : "s"} created.
            </strong>{" "}
            The products use different quotation templates, so each became its own
            RFP. Open each one to add vendors and issue it.
            {notice ? <div className="rl-created-note">{notice}</div> : null}
          </div>
          <button
            type="button"
            className="btn btn--ghost sm icon"
            aria-label="Dismiss"
            onClick={() => setBannerOpen(false)}
          >
            <Icon name="close" size="sm" />
          </button>
        </div>
      ) : null}

      {data && data.length ? (
        <FilterBar
          sticky
          search={{ value: query, onChange: setQuery, placeholder: "Search RFPs" }}
          facet={{
            label: "status",
            placeholder: "Select status",
            value: status,
            onChange: setStatus,
            options: facets.status,
            format: (v) => STATUS_LABEL[v] ?? v,
          }}
          groups={[
            {
              key: "partner",
              label: "Sourcing partner",
              options: facets.partner,
              selected: more.partner,
            },
            { key: "gm", label: "GM", options: facets.gm, selected: more.gm },
            {
              key: "procurement",
              label: "Procurement owner",
              options: facets.procurement,
              selected: more.procurement,
            },
          ]}
          onGroupsChange={(next) =>
            setMore({
              partner: next.partner ?? [],
              gm: next.gm ?? [],
              procurement: next.procurement ?? [],
            })
          }
          // No pager here, so the count lives once, under the bar.
          meta={`${rows.length} RFP${rows.length === 1 ? "" : "s"}`}
        />
      ) : null}

      {error ? (
        <div className="bar bar--danger">
          <Icon name="alert_triangle" />
          <div>
            <strong>RFPs could not be loaded.</strong> {error}
          </div>
        </div>
      ) : null}

      <div className="data-grid-surface sticky-head">
        <table className="data-grid">
          {/* Column ORDER carries the spacing. `Responses` used to sit at
              position 5, left-aligned, splitting the right-aligned numeric run
              (Products / Vendors | Responses | Bids / Lowest) in half — so no
              two numbers shared a right edge and the row read as skewed. The
              three counts now run together against one edge, and Responses —
              the only wide, left-aligned, non-numeric measure — ends the row
              beside the bar it owns. */}
          <colgroup>
            <col style={{ width: "31%" }} />
            <col style={{ width: "11%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "8%" }} />
            {/* 17%, not 13% — "Lowest vs baseline" wrapped to two lines and
                made the header row taller than any body row. */}
            <col style={{ width: "17%" }} />
            <col style={{ width: "15%" }} />
          </colgroup>
          <thead>
            <tr>
              <SortTh sortKey="name" sort={sort} onSort={setSort}>RFP</SortTh>
              <SortTh sortKey="status" sort={sort} onSort={setSort}>Status</SortTh>
              <SortTh sortKey="products" sort={sort} onSort={setSort} num>Products</SortTh>
              <SortTh sortKey="vendors" sort={sort} onSort={setSort} num>Vendors</SortTh>
              <SortTh sortKey="bids" sort={sort} onSort={setSort} num>Bids</SortTh>
              <SortTh sortKey="lowest" sort={sort} onSort={setSort} num>Lowest vs baseline</SortTh>
              <th>Responses</th>
            </tr>
          </thead>
          <tbody>
            {loading
              ? [0, 1, 2, 3].map((i) => (
                  <tr key={i}>
                    {[0, 1, 2, 3, 4, 5, 6].map((c) => (
                      <td key={c}>
                        <div className="sk" style={{ blockSize: 14 }} />
                      </td>
                    ))}
                  </tr>
                ))
              : rows.map((rfp) => {
                  const share = rfp.vendorCount
                    ? rfp.respondedCount / rfp.vendorCount
                    : 0;

                  return (
                    <tr key={rfp.id}>
                      <td>
                        <Link className="rl-name" href={`/rfps/${rfp.id}`}>
                          {rfp.name}
                        </Link>
                        {createdIds.has(rfp.id) ? (
                          <Badge tone="info" className="rl-new">New</Badge>
                        ) : null}
                        <span className="rl-sub">
                          {/* No round. Rounds were replaced by the status
                              ladder (H1) — negotiation is repeatable, so a
                              single number could not describe where a vendor
                              had got to. domain/bidStatus.ts owns it now. */}
                          {rfp.templateName}
                        </span>
                      </td>
                      <td>
                        <Badge tone={STATUS_TONE[rfp.status]}>
                          {STATUS_LABEL[rfp.status] ?? rfp.status}
                        </Badge>
                      </td>
                      <td className="num">
                        {units(rfp.styleCount)}
                        {rfp.stylesWithBids ? (
                          <span className="rl-sub">
                            {rfp.stylesWithBids} bid
                          </span>
                        ) : null}
                      </td>
                      <td className="num">{units(rfp.vendorCount)}</td>
                      <td className="num">
                        {rfp.bidCount || <span className="rl-none">—</span>}
                      </td>
                      <td className="num">
                        {/* FOB against FOB. Negative is a saving. */}
                        {rfp.lowestVsBaseline === null ? (
                          <span className="rl-none">—</span>
                        ) : (
                          <span
                            className={
                              rfp.lowestVsBaseline < 0 ? "rl-save" : "rl-rise"
                            }
                          >
                            {percent(rfp.lowestVsBaseline)}
                          </span>
                        )}
                      </td>
                      <td>
                        {/* A DRAFT has sent nothing, so a 0% bar would imply a
                            problem where there is only work not yet started. */}
                        {rfp.status === "DRAFT" ? (
                          <span className="rl-none">not issued</span>
                        ) : rfp.vendorCount === 0 ? (
                          <span className="rl-none">no vendors</span>
                        ) : (
                          <span className="rl-resp">
                            <span className="rl-bar">
                              <span style={{ inlineSize: percent(share, 0) }} />
                            </span>
                            <span className="rl-resp-k">
                              {rfp.respondedCount} of {rfp.vendorCount}
                            </span>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
          </tbody>
        </table>

        {/* Zero results is its own state: it names what excluded everything
            and offers the way back, rather than reusing the empty-collection
            message, which asks for data to be added. */}
        {!loading && data && data.length > 0 && rows.length === 0 && filtered ? (
          <div className="empty compact">
            <span className="glyph">
              <Icon name="search" size="lg" />
            </span>
            <div className="ttl">No RFPs match these filters</div>
            <div className="desc">Clear a filter or search for a different name.</div>
            <div className="acts">
              <button type="button" className="btn btn--secondary" onClick={clearFilters}>
                Clear filters
              </button>
            </div>
          </div>
        ) : null}

        {!loading && data && data.length === 0 ? (
          <div className="empty compact">
            <span className="glyph">
              <Icon name="invoice" size="lg" />
            </span>
            <div className="ttl">No RFPs yet</div>
            <div className="desc">
              Select products from a style set, and they become one RFP per
              quotation template.
            </div>
            <div className="acts">
              <Link className="btn btn--secondary" href="/style-sets">
                Browse style sets
              </Link>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
