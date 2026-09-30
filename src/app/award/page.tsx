"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Badge, Icon } from "@/ds/components";
import { useApi } from "@/lib/useApi";
import { FacetSelect, facetsOf } from "@/components/FacetSelect";
import { money, percent, unitCost, units } from "@/lib/format";

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
  /**
   * By product or by vendor. §10.2 wanted the vendor pivot as a filter, and
   * this overrides that deliberately: "how is Tirupur doing across the wave"
   * is a real question a product-row list answers only awkwardly.
   */
  const view = params.get("view") === "vendor" ? "vendor" : "product";

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
  const setDivision = (v: string) => setParam("division", v);
  const setDepartment = (v: string) => setParam("department", v);
  const setSubDepartment = (v: string) => setParam("subDepartment", v);
  const setMaterial = (v: string) => setParam("material", v);
  const setVendor = (v: string) => setParam("vendor", v);
  const setView = (v: "product" | "vendor") =>
    setParam("view", v === "vendor" ? "vendor" : "");
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
    (styleId: string) => {
      const q = params.toString();
      return q
        ? `/products/${styleId}/award?back=${encodeURIComponent(q)}`
        : `/products/${styleId}/award`;
    },
    [params],
  );

  function clearAll() {
    // One replace, not eight — setting each param in turn would each read a
    // stale `params` and the last write would win.
    router.replace("/award", { scroll: false });
    setQuery("");
  }

  /**
   * The by-vendor pivot — built from `allocation[]`, which already carries
   * everything needed, so this needs no endpoint of its own.
   *
   * It aggregates AWARDED value, because "how is this vendor doing" is a
   * question about money placed, not bids received.
   */
  const vendorRows = React.useMemo(() => {
    const byVendor = new Map<
      string,
      {
        vendorId: string;
        vendorName: string;
        cooRegion: string | null;
        products: number;
        awardedDollars: number;
        savingsDollars: number;
        awarded: number;
      }
    >();

    for (const r of rows) {
      for (const a of r.allocation) {
        if (a.awardPct <= 0) continue;
        const cur = byVendor.get(a.vendorId) ?? {
          vendorId: a.vendorId,
          vendorName: a.vendorName,
          cooRegion: a.cooRegion,
          products: 0,
          awardedDollars: 0,
          savingsDollars: 0,
          awarded: 0,
        };
        cur.products += 1;
        cur.awardedDollars += a.awardedDollars ?? 0;
        cur.savingsDollars += a.savingsDollars ?? 0;
        if (r.status === "AWARDED") cur.awarded += 1;
        byVendor.set(a.vendorId, cur);
      }
    }

    return [...byVendor.values()].sort(
      (a, b) => b.awardedDollars - a.awardedDollars,
    );
  }, [rows]);

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
            className="btn btn--ghost btn--sm"
            onClick={clearArrivedFilter}
            aria-label="Clear this filter"
          >
            <Icon name="close" size="sm" />
          </button>
        </div>
      ) : null}

      <div className="page-hd">
        <h1>Award summary</h1>
        <div className="acts">
          <span className="aw-summary">
            <span className="k">Savings potential</span>
            <span className="v">{money(totalPotential)}</span>
          </span>
          <span className="aw-summary">
            <span className="k">Placed</span>
            <span className="v">{money(placed)}</span>
          </span>
        </div>
      </div>

      {error ? (
        <div className="bar bar--danger">
          <Icon name="alert_triangle" />
          <div>
            <strong>Award summary could not be loaded.</strong> {error}
          </div>
        </div>
      ) : null}

      {/* Filters in one row above the grid. */}
      {/* Segmented, not tabs: both views show the same filtered set from two
          angles, so this is a control on one screen rather than navigation
          between two. The filters below apply to both. */}
      <div className="seg aw-views" role="group" aria-label="Summary view">
        <button
          className={view === "product" ? "on" : undefined}
          aria-pressed={view === "product"}
          onClick={() => setView("product")}
        >
          By product
        </button>
        <button
          className={view === "vendor" ? "on" : undefined}
          aria-pressed={view === "vendor"}
          onClick={() => setView("vendor")}
        >
          By vendor
        </button>
      </div>

      <div className="aw-filters">
        <div className="control search sm aw-search">
          <Icon name="search" size="sm" />
          {/* Keyed on the URL value: a Back press or a pasted link remounts
              this with the new text, without an effect painting a stale frame
              first. */}
          <input
            key={urlQuery}
            placeholder="Search products"
            aria-label="Search products"
            defaultValue={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <FacetSelect
          label="status"
          allLabel="All statuses"
          value={status}
          onChange={setStatus}
          options={facets.status}
        />
        <FacetSelect
          label="division"
          value={division}
          onChange={setDivision}
          options={facets.division}
        />
        <FacetSelect
          label="department"
          value={department}
          onChange={setDepartment}
          options={facets.department}
        />
        <FacetSelect
          label="sub-department"
          value={subDepartment}
          onChange={setSubDepartment}
          options={facets.subDepartment}
        />
        <FacetSelect
          label="material"
          value={material}
          onChange={setMaterial}
          options={facets.material}
        />
        <FacetSelect
          label="region"
          value={region}
          onChange={setRegion}
          options={facets.region}
        />
        <FacetSelect
          label="vendor"
          value={vendor}
          onChange={setVendor}
          options={facets.vendor}
        />

        {anyFilter ? (
          <button className="btn btn--ghost btn--sm" onClick={clearAll}>
            Clear filters
          </button>
        ) : null}

        <span className="aw-filter-count">
          {view === "product"
            ? `${rows.length} of ${data?.length ?? 0} products`
            : `${vendorRows.length} vendors across ${rows.length} products`}
        </span>

        {/* Filters select PRODUCTS, and in the vendor view that is not
            self-evident: filtering region to ISC still lists EMEA and CHINA
            vendors, because they hold volume on products an ISC vendor bid.
            Correct, but a reader assumes the filter narrowed the vendors —
            so it says which. */}
        {view === "vendor" && anyFilter ? (
          <span className="aw-filter-note">
            <Icon name="info_circle" size="sm" />
            Every vendor allocated on the {rows.length} matching{" "}
            {rows.length === 1 ? "product" : "products"} — filters select
            products, not vendors.
          </span>
        ) : null}
      </div>

      {view === "product" ? (
        <div className="data-grid-surface">
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
                    </div>
                  </td>
                </tr>
              ) : null}

              {rows.map((row) => {
                const hasBids = row.bidCount > 0;
                return (
                  /* A ROW NAVIGATES now. It used to open the Playground
                     drawer; allocation is a full page, so the destination is a
                     URL that can be sent to someone. */
                  <tr
                    key={row.id}
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
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <VendorView rows={vendorRows} />
      )}

    </>
  );
}

/**
 * The by-vendor pivot.
 *
 * §10.2 specified the vendor angle as a filter rather than a view, and this
 * overrides that deliberately: "how is Tirupur doing across the wave" is a
 * real question, and a product-row list answers it only by making the reader
 * add up percentages across rows.
 *
 * Built entirely from `allocation[]` on the product rows — no endpoint of its
 * own — so the two views can never report different totals for the same
 * filtered set.
 */
function VendorView({
  rows,
}: {
  rows: {
    vendorId: string;
    vendorName: string;
    cooRegion: string | null;
    products: number;
    awardedDollars: number;
    savingsDollars: number;
    awarded: number;
  }[];
}) {
  const total = rows.reduce((s, r) => s + r.awardedDollars, 0);

  if (rows.length === 0) {
    return (
      <div className="empty compact">
        <span className="glyph">
          <Icon name="users" size="lg" />
        </span>
        <div className="ttl">Nothing allocated yet</div>
        <div className="desc">
          This view shows where award value has been placed. Allocate a product
          and its vendors appear here.
        </div>
      </div>
    );
  }

  return (
    <div className="data-grid-surface">
      <table className="data-grid aw-grid">
        <colgroup>
          <col style={{ width: "30%" }} />
          <col style={{ width: "10%" }} />
          <col style={{ width: "12%" }} />
          <col style={{ width: "12%" }} />
          <col style={{ width: "22%" }} />
          <col style={{ width: "14%" }} />
        </colgroup>
        <thead>
          <tr>
            <th>Vendor</th>
            <th className="num">Products</th>
            <th className="num">Awarded value</th>
            <th className="num">Savings</th>
            <th>Share of allocated value</th>
            <th className="num">Awarded</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const share = total > 0 ? r.awardedDollars / total : 0;
            return (
              <tr key={r.vendorId}>
                <td>
                  <Link className="aw-vend-link" href={`/vendors/${r.vendorId}`}>
                    {r.vendorName}
                  </Link>
                  <span className="aw-product-meta">
                    {r.cooRegion ?? "region not set"}
                  </span>
                </td>
                <td className="num">{r.products}</td>
                <td className="num">{money(r.awardedDollars)}</td>
                <td className="num">
                  <span className={r.savingsDollars >= 0 ? "aw-pos" : "aw-neg"}>
                    {money(r.savingsDollars)}
                  </span>
                </td>
                <td>
                  {/* Share of what is ALLOCATED in the current filter, not of
                      the wave — a filtered view showing wave-wide shares would
                      be read as the wave and it is not. */}
                  <span className="aw-share">
                    <span className="aw-share-bar">
                      <span style={{ inlineSize: percent(share, 0) }} />
                    </span>
                    <span className="aw-share-k">{percent(share, 0)}</span>
                  </span>
                </td>
                <td className="num">
                  {r.awarded > 0 ? (
                    <Badge tone="success">
                      {r.awarded} of {r.products}
                    </Badge>
                  ) : (
                    <span className="aw-muted">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
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
