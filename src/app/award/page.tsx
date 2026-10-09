"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Badge, Icon } from "@/ds/components";
import { useApi } from "@/lib/useApi";
import { facetsOf } from "@/components/FacetSelect";
import { FilterBar } from "@/components/FilterBar";
import { SummaryStrip } from "@/components/SummaryStrip";
import { money, unitCost, units } from "@/lib/format";

/**
 * S6 — Award Summary.
 *
 * One row per style, sorted by savings potential, because the question this
 * screen answers is "where is the money". Everything else is a filter on top of
 * that ordering.
 *
 * Ranking runs on landed Best Cost, not FOB — see lib/bestCost.
 */

export type AllocationRow = {
  vendorId: string;
  vendorName: string;
  cooRegion: string | null;
  awardPct: number;
  bestCost: number | null;
  bestCostBasis: string | null;
  awardedDollars: number | null;
  savingsDollars: number | null;
};

export type AwardRow = {
  id: string;
  styleNumber: string;
  name: string;
  division: string | null;
  department: string | null;
  subDepartment: string | null;
  material: string | null;
  heroImage: string | null;
  planUnits: number;
  baselineFob: number;
  baselineLanded: number;
  bidCount: number;
  bestAvailableCost: number | null;
  bestAvailableBasis: string | null;
  savingsPotential: number;
  status: "UNTOUCHED" | "ALLOCATED" | "READY_FOR_REVIEW" | "AWARDED";
  allocation: AllocationRow[];
  /** N6 — how many variations, and how many are at 100%. */
  variationCount: number;
  allocatedVariations: number;
  /** One per variation; EMPTY for a single-group (STYLE-grained) product. */
  variations: {
    variationId: string | null;
    label: string;
    planUnits: number;
    bidCount: number;
    bestAvailableCost: number | null;
    savingsPotential: number;
    allocatedPct: number;
    status: string;
    awardedDollars: number;
    savingsDollars: number;
    allocation: { vendorId: string; vendorName: string; awardPct: number }[];
  }[];
  /**
   * EVERY vendor that bid, with their region — not only the winners. The
   * region filter reads this, so a style with bids but no allocation is still
   * findable by region; it used to read `allocation[]` alone and lose them.
   */
  bidders: {
    vendorId: string;
    vendorName: string;
    cooRegion: string | null;
    bestCost: number;
  }[];
  awardedDollars: number;
  savingsDollars: number;
};

const STATUS_LABEL: Record<AwardRow["status"], string> = {
  UNTOUCHED: "Not started",
  ALLOCATED: "Allocated",
  READY_FOR_REVIEW: "Ready for review",
  AWARDED: "Awarded",
};

const STATUS_TONE: Record<AwardRow["status"], "success" | "info" | "warning" | undefined> = {
  UNTOUCHED: undefined,
  ALLOCATED: "info",
  READY_FOR_REVIEW: "warning",
  AWARDED: "success",
};

const REGIONS = ["CHINA", "SEA", "ISC", "AMERICAS", "EMEA"];

function AwardPageInner() {
  const { data, loading, error } = useApi<AwardRow[]>("/api/award-summary");

  /**
   * Filters can arrive in the URL, which is what makes a breach on Wave
   * Insights CLICKABLE THROUGH to the products responsible for it — the
   * difference between a number and something you can act on (Build Doc 11.9).
   * They are the initial value only; the controls own the state after that.
   */
  const params = useSearchParams();
  const router = useRouter();
  /**
   * FILTERS LIVE IN THE URL.
   *
   * They used to be plain state, with only `cooRegion` and `q` read on mount
   * and nothing ever written back — so clicking a product dropped all seven
   * filters and the view toggle, and there was no way back to the list you
   * were looking at. Now the URL is the state, which buys three things at
   * once: the browser Back button works, the breadcrumb on the product page
   * can return here, and a filtered view is a link you can send someone.
   *
   * Wave Insights already deep-links here with `?cooRegion=`, so this extends
   * a pattern rather than adding one.
   */
  const status = params.get("status") ?? "";
  const region = params.get("cooRegion") ?? "";
  const division = params.get("division") ?? "";
  const department = params.get("department") ?? "";
  const subDepartment = params.get("subDepartment") ?? "";
  const material = params.get("material") ?? "";
  const vendor = params.get("vendor") ?? "";
  /*
   * BY PRODUCT ONLY — 5 Oct. Akshay: "remove product/vendor toggle in award
   * summary page. as we will just have By product." The by-vendor pivot is
   * gone with its toggle; "how is a vendor doing across the wave" is Wave
   * Insights' vendor spend table, which already answers it per vendor with
   * the cap. The `vendor` FILTER above stays — it narrows products.
   */

  /**
   * `replace`, not `push`: a filter change is not a navigation step. With
   * push, Back would walk keystroke by keystroke through every filter the user
   * tried instead of leaving the screen.
   *
   * `scroll: false` because writing the URL must not jump a scrolled list
   * back to the top.
   */
  const setParam = React.useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      router.replace(next.toString() ? `/award?${next}` : "/award", {
        scroll: false,
      });
    },
    [params, router],
  );

  const setStatus = (v: string) => setParam("status", v);
  const setRegion = (v: string) => setParam("cooRegion", v);
  /**
   * Search is the one filter that stays LOCAL, mirrored to the URL on a
   * debounce.
   *
   * A select fires once per choice, so writing the URL there is free. A text
   * input fires per keystroke, and `router.replace` on each one makes typing
   * feel heavy for no gain. So the input responds immediately and the URL
   * catches up 350ms later — which is what a shared link or a Back press
   * needs, not what each keystroke needs.
   *
   * The input is KEYED on the URL value (see `.aw-search` below), so a Back
   * press or a pasted link remounts it with the new text. Keying is how the
   * rest of this codebase resets state — an effect calling setState paints one
   * stale frame first, and syncing a ref during render is unsound.
   */
  const urlQuery = params.get("q") ?? "";
  const [query, setQuery] = React.useState(urlQuery);

  React.useEffect(() => {
    if (query === urlQuery) return;
    const t = setTimeout(() => setParam("q", query), 350);
    return () => clearTimeout(t);
  }, [query, urlQuery, setParam]);

  /**
   * Arrived from a Wave Insights breach. Two problems this fixes: there was no
   * way back, and the filter was applied SILENTLY — a list showing 3 of 82
   * products with no stated reason looks like missing data rather than a
   * deliberate view.
   */
  const cameFrom = params.get("from");
  const arrivedFilter = params.get("cooRegion") ?? params.get("q");
  const showContext =
    cameFrom === "insights" &&
    Boolean(arrivedFilter) &&
    // Clearing the filter clears the bar — it describes the filter, so it must
    // not outlive it.
    (params.get("cooRegion") ? region === params.get("cooRegion") : query === params.get("q"));

  function clearArrivedFilter() {
    if (params.get("cooRegion")) setRegion("");
    else setQuery("");
  }

  /**
   * One predicate per dimension, so facet counts can be computed with a given
   * dimension EXCLUDED from its own filter. Without that, selecting "ISC"
   * makes every other region read (0) and the control becomes unusable — you
   * can never see what switching to SEA would give you.
   */
  const predicates = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return {
      status: (r: AwardRow) => !status || r.status === status,
      division: (r: AwardRow) => !division || r.division === division,
      department: (r: AwardRow) => !department || r.department === department,
      subDepartment: (r: AwardRow) =>
        !subDepartment || r.subDepartment === subDepartment,
      material: (r: AwardRow) => !material || r.material === material,
      // Region and vendor read the BIDDERS, not just the winners, so a style
      // that has bids but no allocation is still findable.
      region: (r: AwardRow) =>
        !region || r.bidders.some((b) => b.cooRegion === region),
      vendor: (r: AwardRow) =>
        !vendor || r.bidders.some((b) => b.vendorName === vendor),
      query: (r: AwardRow) =>
        !q ||
        r.styleNumber.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q),
    };
  }, [status, division, department, subDepartment, material, region, vendor, query]);

  const rows = React.useMemo(
    () =>
      (data ?? []).filter((r) => Object.values(predicates).every((p) => p(r))),
    [data, predicates],
  );

  /** Rows passing every filter EXCEPT the named one. */
  const without = React.useCallback(
    (skip: keyof typeof predicates) =>
      (data ?? []).filter((r) =>
        Object.entries(predicates)
          .filter(([k]) => k !== skip)
          .every(([, p]) => p(r)),
      ),
    [data, predicates],
  );

  const facets = React.useMemo(
    () => ({
      status: facetsOf(without("status"), (r) => r.status),
      division: facetsOf(without("division"), (r) => r.division),
      department: facetsOf(without("department"), (r) => r.department),
      subDepartment: facetsOf(without("subDepartment"), (r) => r.subDepartment),
      material: facetsOf(without("material"), (r) => r.material),
      // All five regions always listed: a region with no bids is information,
      // not an option to hide.
      region: facetsOf(without("region"), (r) =>
        r.bidders.map((b) => b.cooRegion), REGIONS),
      vendor: facetsOf(without("vendor"), (r) =>
        r.bidders.map((b) => b.vendorName)),
    }),
    [without],
  );

  const anyFilter =
    !!status || !!division || !!department || !!subDepartment || !!material ||
    !!region || !!vendor || !!query.trim();

  /**
   * The product page's destination, carrying the current filters as `?back=`
   * so its breadcrumb can return to THIS list rather than a bare /award.
   */
  const productHref = React.useCallback(
    (styleId: string, variationId?: string | null) => {
      const q = new URLSearchParams();
      const back = params.toString();
      if (back) q.set("back", back);
      // A variation row opens the product ON that size (N6).
      if (variationId) q.set("v", variationId);
      const qs = q.toString();
      return qs ? `/products/${styleId}/award?${qs}` : `/products/${styleId}/award`;
    },
    [params],
  );

  /**
   * One product open at a time — the catalog's rule (1b), so the list never
   * turns into a wall of size rows.
   */
  const [openId, setOpenId] = React.useState<string | null>(null);

  function clearAll() {
    // One replace, not eight — setting each param in turn would each read a
    // stale `params` and the last write would win.
    router.replace("/award", { scroll: false });
    setQuery("");
  }

  const withBids = rows.filter((r) => r.bidCount > 0);
  const totalPotential = withBids.reduce((s, r) => s + Math.max(0, r.savingsPotential), 0);
  const placed = rows.reduce((s, r) => s + r.awardedDollars, 0);


  return (
    <>
      {showContext ? (
        <div className="ctx-bar">
          <Link className="ctx-back" href="/insights">
            <Icon name="arrow_left" size="sm" />
            Wave insights
          </Link>
          <span className="ctx-what">
            Showing{" "}
            {params.get("cooRegion")
              ? `${params.get("cooRegion")} products`
              : `products matching "${params.get("q")}"`}
            {params.get("reason") ? ` · ${params.get("reason")}` : ""}
          </span>
          <button
            className="btn btn--ghost sm"
            onClick={clearArrivedFilter}
            aria-label="Clear this filter"
          >
            <Icon name="close" size="sm" />
          </button>
        </div>
      ) : null}

      <div className="page-hd">
        <div className="row">
          <div className="grow">
            <h1 className="ttl">Award summary</h1>
          </div>
        </div>
      </div>

      {/* Flat, equal cards across the width (Aravind, C40). */}
      <SummaryStrip
        items={[
          { label: "Savings potential", value: money(totalPotential) },
          { label: "Placed", value: money(placed) },
        ]}
      />

      {error ? (
        <div className="bar bar--danger">
          <Icon name="alert_triangle" />
          <div>
            <strong>Award summary could not be loaded.</strong> {error}
          </div>
        </div>
      ) : null}


      {/* Filter & sort pattern (Aravind, C39): search, Status facet,
          the rest in the More filters panel (6 groups). */}
      <FilterBar
          sticky
        search={{ value: query, onChange: setQuery, placeholder: "Search products" }}
        facet={{
          label: "status",
          placeholder: "Select status",
          value: status,
          onChange: setStatus,
          options: facets.status,
          format: (v) => STATUS_LABEL[v as AwardRow["status"]] ?? v,
        }}
        groups={[
          { key: "division", label: "Division", single: true, options: facets.division, selected: division ? [division] : [] },
          { key: "department", label: "Department", single: true, options: facets.department, selected: department ? [department] : [] },
          { key: "subDepartment", label: "Sub-department", single: true, options: facets.subDepartment, selected: subDepartment ? [subDepartment] : [] },
          { key: "material", label: "Material", single: true, options: facets.material, selected: material ? [material] : [] },
          { key: "region", label: "Region", single: true, options: facets.region, selected: region ? [region] : [] },
          { key: "vendor", label: "Vendor", single: true, options: facets.vendor, selected: vendor ? [vendor] : [] },
        ]}
        onGroupsChange={(next) => {
          const q = new URLSearchParams(params.toString());
          for (const k of ["division", "department", "subDepartment", "material", "cooRegion", "vendor"]) q.delete(k);
          const put = (k: string, v?: string) => { if (v) q.set(k, v); };
          put("division", next.division?.[0]);
          put("department", next.department?.[0]);
          put("subDepartment", next.subDepartment?.[0]);
          put("material", next.material?.[0]);
          put("cooRegion", next.region?.[0]);
          put("vendor", next.vendor?.[0]);
          router.replace(q.toString() ? `/award?${q}` : "/award", { scroll: false });
        }}
        meta={`${rows.length} product${rows.length === 1 ? "" : "s"}`}
      />

      <div className="data-grid-surface sticky-head">
          <table className="data-grid aw-grid">
            <colgroup>
              <col style={{ width: "38%" }} />
              <col style={{ width: "7%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "14%" }} />
              <col style={{ width: "17%" }} />
              <col style={{ width: "12%" }} />
            </colgroup>
            <thead>
              <tr>
                <th>Product</th>
                <th className="num">Bids</th>
                <th className="num">Best cost</th>
                <th className="num">Savings potential</th>
                <th>Allocation</th>
                <th className="act">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i}>
                      <td colSpan={6}>
                        <div className="sk" style={{ blockSize: 32 }} />
                      </td>
                    </tr>
                  ))
                : null}

              {!loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <div className="empty compact">
                      <span className="glyph">
                        <Icon name="search" size="lg" />
                      </span>
                      <div className="ttl">No products match</div>
                      <div className="desc">
                        {data?.length
                          ? "Try a different filter or search."
                          : "Once vendors submit bids, their products appear here."}
                      </div>
                      {anyFilter ? (
                        <div className="acts">
                          <button type="button" className="btn btn--secondary" onClick={clearAll}>
                            Clear filters
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ) : null}

              {rows.map((row) => {
                const hasBids = row.bidCount > 0;
                const expandable = row.variations.length > 1;
                const isOpen = openId === row.id;
                return (
                  <React.Fragment key={row.id}>
                  {/* A ROW NAVIGATES. It used to open the Playground drawer;
                     allocation is a full page, so the destination is a URL
                     that can be sent to someone. */}
                  <tr
                    className={hasBids ? "aw-row" : "aw-row is-disabled"}
                    onClick={
                      hasBids
                        ? () => router.push(productHref(row.id))
                        : undefined
                    }
                    tabIndex={hasBids ? 0 : -1}
                    role={hasBids ? "button" : undefined}
                    aria-label={hasBids ? `Allocate ${row.name}` : undefined}
                    onKeyDown={(e) => {
                      if (hasBids && (e.key === "Enter" || e.key === " ")) {
                        e.preventDefault();
                        router.push(productHref(row.id));
                      }
                    }}
                  >
                    <td>
                      <div className="aw-product">
                        {/* The chevron is its OWN button inside the cell —
                            the row already navigates, so it stops the click
                            from reaching the row (the catalog pattern, 1b).
                            Absent on a STYLE-grained product: an expander
                            onto one row restating the product reads as
                            broken. */}
                        {expandable ? (
                          <button
                            type="button"
                            className="aw-chev"
                            aria-expanded={isOpen}
                            aria-label={`${isOpen ? "Hide" : "Show"} ${row.variations.length} variations of ${row.name}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenId(isOpen ? null : row.id);
                            }}
                            onKeyDown={(e) => e.stopPropagation()}
                          >
                            <Icon name={isOpen ? "chevron_down" : "chevron_right"} size="sm" />
                          </button>
                        ) : (
                          <span className="aw-chev-gap" aria-hidden="true" />
                        )}
                        {row.heroImage ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            className="aw-thumb"
                            src={row.heroImage}
                            alt=""
                            loading="lazy"
                          />
                        ) : (
                          <span className="aw-thumb aw-thumb--empty" />
                        )}
                        <span className="aw-product-text">
                          <span className="aw-product-name">
                            <span className="id">{row.styleNumber}</span>
                            <span className="aw-name">{row.name}</span>
                          </span>
                          <span className="aw-product-meta">
                            {[row.department, row.subDepartment]
                              .filter(Boolean)
                              .join(" · ")}
                            {" · "}
                            {units(row.planUnits)} units/yr
                          </span>
                        </span>
                      </div>
                    </td>

                    <td className="num">{row.bidCount || "—"}</td>

                    <td className="num">
                      {row.bestAvailableCost !== null
                        ? unitCost(row.bestAvailableCost)
                        : "—"}
                    </td>

                    <td className="num">
                      {hasBids ? (
                        <span
                          className={
                            row.savingsPotential < 0 ? "aw-neg" : undefined
                          }
                        >
                          {money(row.savingsPotential)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>

                    <td>
                      {row.allocation.length ? (
                        <span className="aw-split">
                          {row.allocation
                            .slice()
                            .sort((a, b) => b.awardPct - a.awardPct)
                            .map((a) => (
                              <span className="aw-split-part" key={a.vendorId}>
                                <span className="pct">{a.awardPct}%</span>
                                {a.vendorName}
                              </span>
                            ))}
                        </span>
                      ) : (
                        <span className="aw-muted">—</span>
                      )}
                    </td>

                    <td className="act">
                      <Badge tone={STATUS_TONE[row.status]}>
                        {STATUS_LABEL[row.status]}
                      </Badge>
                      {/* How many sizes are done — a product cannot move to
                          review until every one is at 100 (N3). */}
                      {expandable ? (
                        <span className="aw-var-count">
                          {row.allocatedVariations} of {row.variationCount} allocated
                        </span>
                      ) : null}
                    </td>
                  </tr>

                  {isOpen
                    ? row.variations.map((v) => (
                        <tr
                          key={`${row.id}-${v.variationId}`}
                          className="aw-var-row"
                          onClick={() => router.push(productHref(row.id, v.variationId))}
                          tabIndex={0}
                          role="button"
                          aria-label={`Allocate ${v.label} of ${row.name}`}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              router.push(productHref(row.id, v.variationId));
                            }
                          }}
                        >
                          <td>
                            <span className="aw-var-label">
                              {v.label}
                              <span className="aw-product-meta">
                                {" · "}
                                {units(v.planUnits)} units/yr
                              </span>
                            </span>
                          </td>
                          <td className="num">{v.bidCount || "—"}</td>
                          <td className="num">
                            {v.bestAvailableCost !== null ? unitCost(v.bestAvailableCost) : "—"}
                          </td>
                          <td className="num">
                            <span className={v.savingsPotential < 0 ? "aw-neg" : undefined}>
                              {money(v.savingsPotential)}
                            </span>
                          </td>
                          <td>
                            {v.allocation.length ? (
                              <span className="aw-split">
                                {v.allocation
                                  .slice()
                                  .sort((a, b) => b.awardPct - a.awardPct)
                                  .map((a) => (
                                    <span className="aw-split-part" key={a.vendorId}>
                                      <span className="pct">{a.awardPct}%</span>
                                      {a.vendorName}
                                    </span>
                                  ))}
                              </span>
                            ) : (
                              <span className="aw-muted">Not allocated</span>
                            )}
                          </td>
                          <td className="act">
                            <Badge
                              tone={
                                Math.abs(v.allocatedPct - 100) < 0.005
                                  ? STATUS_TONE[v.status as AwardRow["status"]]
                                  : undefined
                              }
                            >
                              {Math.abs(v.allocatedPct - 100) < 0.005
                                ? STATUS_LABEL[v.status as AwardRow["status"]]
                                : "Not yet"}
                            </Badge>
                          </td>
                        </tr>
                      ))
                    : null}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

    </>
  );
}


/**
 * `useSearchParams()` opts this route out of static prerendering, and Next
 * requires a Suspense boundary to say what to show while the URL is unknown.
 * Without it `next build` fails on this page — which `next dev` never
 * reveals, because dev does not prerender.
 */
export default function AwardPage() {
  return (
    <React.Suspense fallback={<div className="sk" style={{ blockSize: 320 }} />}>
      <AwardPageInner />
    </React.Suspense>
  );
}
