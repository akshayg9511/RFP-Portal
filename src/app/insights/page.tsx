"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Badge, Icon, Tooltip } from "@/ds/components";
import { useApi } from "@/lib/useApi";
import { SideDrawer } from "@/components/SideDrawer";
import { FacetSelect } from "@/components/FacetSelect";
import { money, percent, unitCost, units } from "@/lib/format";

/** 1,360,287 -> 1.36M. Rollup altitude; the exact figure lives on the row. */
function compactUnits(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  return units(n);
}
import {
  SplitCapBar,
  CoverageMeter,
  Donut,
  RangeBars,
  REGION_ORDER,
} from "@/components/charts";

/**
 * S8 — Wave Insights. The rollup.
 *
 * COVERAGE LEADS, and that ordering is the whole point. China at 29% means
 * something completely different at 48% coverage than at 95%, so every
 * percentage below is explicitly "of dollars placed so far". Without that the
 * screen quietly overstates its own certainty and people relax — or panic —
 * early (Build Doc 11.9).
 *
 * Both ends of every guardrail range show here. Over-max also appears on the
 * Playground rail because it is fixable from one style; under-min does not,
 * because it usually needs a bidder-pool change. Neither ever blocks a save.
 */

type CooStatus = {
  region: string;
  dollars: number;
  share: number;
  min: number;
  max: number;
  overMax: boolean;
  underMin: boolean;
  gapPoints: number | null;
};

type VendorSpend = {
  vendorId: string;
  vendorName: string;
  isNewToQuince: boolean;
  /** Spend in the SELECTED slice. */
  dollars: number;
  cap: number;
  breached: boolean;
  headroom: number;
  /** N14 — the slice's spend split by relationship to each product won. */
  split: { incumbent: number; existing: number; new: number };
  /** N16 — the vendor's WAVE-WIDE total, which is what the cap is checked on. */
  waveDollars: number;
  waveBreached: boolean;
};

type Facet = { value: string; count: number };

type Insights = {
  coverage: {
    stylesDecided: number;
    stylesInPlay: number;
    unitsDecided: number;
    unitsInPlay: number;
    baselineDecided: number;
    baselineInPlay: number;
    /** The headline. Baseline-against-baseline, so it can never exceed 1. */
    shareDecided: number;
    committedSpend: number;
    savings: number;
    savingsPercent: number;
    stylesInCatalogue: number;
    catalogueValue: number;
    notInPlayStyles: number;
    notInPlayValue: number;
  };
  guardrails: {
    coo: CooStatus[];
    vendors: VendorSpend[];
    unclassifiedDollars: number;
    incumbencyTotals: { incumbent: number; existing: number; new: number };
  };
  /** N8/N9 — whether a filter is applied, and which. */
  scope: {
    filtered: boolean;
    division: string | null;
    department: string | null;
    subDepartment: string | null;
  };
  facets: { division: Facet[]; department: Facet[]; subDepartment: Facet[] };
  vendorTypeSplit: Record<string, number>;
  savings: { dollars: number; percentVsBaseline: number };
  stylesTakingIncrease: {
    styleId: string;
    styleNumber: string;
    styleName: string;
    vendorNames: string[];
    increaseDollars: number;
  }[];
};

/**
 * Existing vs New only (N12). Incumbent is a PRODUCT-level attribute, so it
 * left this chart and lives in the cap bars instead (N14).
 */
const TYPE_LABEL: Record<string, string> = {
  EXISTING: "Existing",
  NEW: "New to Quince",
};

// Vendor type is its own axis, so it does NOT reuse the region palette —
// reusing it would imply a relationship between "China" and "Incumbent".
// cat-2 and cat-4 match the cap bars' existing and new segments, so the two
// charts never disagree about what a colour means.
const TYPE_COLOR: Record<string, string> = {
  EXISTING: "var(--chart-cat-2)",
  NEW: "var(--chart-cat-4)",
};

/**
 * `useSearchParams()` needs a Suspense boundary to prerender — the reason
 * `next build` failed on three pages in A17. Same shape as /award.
 */
export default function InsightsPage() {
  return (
    <React.Suspense fallback={<div className="sk" style={{ blockSize: 320 }} />}>
      <InsightsInner />
    </React.Suspense>
  );
}

function InsightsInner() {
  const router = useRouter();
  /**
   * DIVISION · DEPARTMENT · SUB-DEPARTMENT — N8.
   *
   * In the URL, like Award Summary, so "China across Womens" is a link
   * someone can be sent. No wave filter: the unfiltered page IS the wave.
   * Each level narrows the ones below it, and changing a level clears what
   * sits under it — a sub-department from another division is a filter that
   * can only ever return nothing.
   */
  const search = useSearchParams();
  const division = search.get("division") ?? "";
  const department = search.get("department") ?? "";
  const subDepartment = search.get("subDepartment") ?? "";
  const query = new URLSearchParams();
  if (division) query.set("division", division);
  if (department) query.set("department", department);
  if (subDepartment) query.set("subDepartment", subDepartment);
  const qs = query.toString();
  const { data, loading, error } = useApi<Insights>(
    `/api/wave-insights${qs ? `?${qs}` : ""}`,
  );

  function setLevel(level: "division" | "department" | "subDepartment", value: string) {
    const next = new URLSearchParams(search.toString());
    const order = ["division", "department", "subDepartment"] as const;
    // Clear this level and everything beneath it, then set this one.
    for (const l of order.slice(order.indexOf(level))) next.delete(l);
    if (value) next.set(level, value);
    const out = next.toString();
    router.replace(out ? `?${out}` : "?", { scroll: false });
  }
  const filtered = Boolean(division || department || subDepartment);

  const cov = data?.coverage;
  const coo = React.useMemo(() => {
    const rows = data?.guardrails.coo ?? [];
    // Fixed order — never re-sorted by value, or the colours would follow rank
    // instead of entity and a filter would repaint the survivors.
    return [...rows].sort(
      (a, b) =>
        REGION_ORDER.indexOf(a.region as never) -
        REGION_ORDER.indexOf(b.region as never),
    );
  }, [data]);

  const breaches = coo.filter((c) => c.overMax || c.underMin);
  // Judged on the WAVE-WIDE total (N16), so a filter can never hide one.
  const vendorBreaches = (data?.guardrails.vendors ?? []).filter((v) => v.waveBreached);

  const [vendorQuery, setVendorQuery] = React.useState("");
  const [openVendorId, setOpenVendorId] = React.useState<string | null>(null);

  /**
   * Breached vendors pinned to the top, then by spend. A cap breach must never
   * be something you have to scroll to find — and with ~38 vendors at full
   * allocation, it would be.
   */
  const vendorRows = React.useMemo(() => {
    const q = vendorQuery.trim().toLowerCase();
    return (data?.guardrails.vendors ?? [])
      .filter((v) => !q || v.vendorName.toLowerCase().includes(q))
      .sort((a, b) => {
        if (a.waveBreached !== b.waveBreached) return a.waveBreached ? -1 : 1;
        return b.dollars - a.dollars;
      });
  }, [data, vendorQuery]);

  const openVendor = vendorRows.find((v) => v.vendorId === openVendorId) ?? null;

  const typeSlices = Object.entries(data?.vendorTypeSplit ?? {})
    .filter(([, v]) => v > 0)
    .map(([k, v]) => ({ label: TYPE_LABEL[k] ?? k, value: v, color: TYPE_COLOR[k] }));
  const typeTotal = typeSlices.reduce((s, d) => s + d.value, 0);

  return (
    <>
      <div className="page-hd">
        <h1>Wave insights</h1>
      </div>

      {data ? (
        <div className="aw-filters">
          <FacetSelect
            label="Division"
            value={division}
            onChange={(v) => setLevel("division", v)}
            options={data.facets.division}
          />
          <FacetSelect
            label="Department"
            value={department}
            onChange={(v) => setLevel("department", v)}
            options={data.facets.department}
          />
          <FacetSelect
            label="Sub-department"
            value={subDepartment}
            onChange={(v) => setLevel("subDepartment", v)}
            options={data.facets.subDepartment}
          />
          {filtered ? (
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => router.replace("?", { scroll: false })}
            >
              Show the whole wave
            </button>
          ) : null}
        </div>
      ) : null}

      {/* N9 — the same thresholds below wave level, but as FLAGS. One
          department can be legitimately China-heavy while the wave stays
          compliant, so the hard guardrail is only ever the wave's. */}
      {filtered ? (
        <div className="bar bar--info" style={{ marginBlockEnd: "var(--space-lg)" }}>
          <Icon name="info_circle" />
          <div>
            <strong>
              Showing {[division, department, subDepartment].filter(Boolean).join(" › ")} only.
            </strong>{" "}
            The same ranges apply, shown as flags — the guardrail itself is
            judged on the whole wave. Vendor caps are always checked on each
            vendor&rsquo;s wave-wide total.
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="bar bar--danger">
          <Icon name="alert_triangle" />
          <div>
            <strong>Insights could not be loaded.</strong> {error}
          </div>
        </div>
      ) : null}

      {loading && !data ? (
        <div className="card">
          <div className="card-b">
            <div className="sk" style={{ blockSize: 180 }} />
          </div>
        </div>
      ) : null}

      {data && cov ? (
        <>
          {/* 1 — COVERAGE FIRST. Everything below is read through this. */}
          <div className="card raised wi-coverage">
            <div className="card-b">
              <div className="wi-cov-grid">
                <div className="wi-cov-main">
                  {/* PROGRESS AND SAVINGS ARE DIFFERENT QUESTIONS and this card
                      now answers them separately. The old single percentage
                      divided committed spend by baseline value — it fell when we
                      negotiated well, and two styles read over 100%. */}
                  <span className="k">
                    Wave progress
                    <Tooltip
                      tip="Share of biddable baseline value now decided — products with at least one submitted bid. Measured baseline against baseline, so it only rises as you decide more. Savings is shown separately below."
                      placement="bottom"
                    >
                      <Icon name="info_circle" size="sm" />
                    </Tooltip>
                  </span>
                  <span className="v">{percent(cov.shareDecided)}</span>
                  <span className="s">
                    of biddable value decided ·{" "}
                    {money(cov.baselineDecided)} of {money(cov.baselineInPlay)}{" "}
                    baseline
                  </span>
                  <CoverageMeter share={cov.shareDecided} />

                  {/* The three frames that make the percentage legible. */}
                  <dl className="wi-breakdown">
                    <dt>Decided</dt>
                    <dd>
                      {cov.stylesDecided} of {cov.stylesInPlay} products ·{" "}
                      {/* Abbreviated: "1,360,287 of 1,651,610" is a number you
                          read rather than scan, and the precision buys nothing
                          at this altitude. */}
                      {compactUnits(cov.unitsDecided)} of{" "}
                      {compactUnits(cov.unitsInPlay)} units
                    </dd>
                    <dt className="sub">
                      <span className="dot is-on" aria-hidden="true" />
                      Still to decide
                    </dt>
                    <dd className="sub">
                      {cov.stylesInPlay - cov.stylesDecided} products ·{" "}
                      {money(cov.baselineInPlay - cov.baselineDecided)}
                    </dd>
                    <dt className="sub">
                      <span className="dot" aria-hidden="true" />
                      Not yet out to bid
                    </dt>
                    <dd className="sub">
                      {cov.notInPlayStyles} products ·{" "}
                      {money(cov.notInPlayValue)}
                    </dd>
                  </dl>
                </div>

                <div className="wi-cov-side">
                  {/* Savings is its OWN number, not a share of progress. */}
                  <div className="wi-stat">
                    <span className="k">Committed spend</span>
                    <span className="v">{money(cov.committedSpend)}</span>
                    <span className="s">
                      for {money(cov.baselineDecided)} of baseline
                    </span>
                  </div>
                  <div className="wi-stat">
                    <span className="k">Savings</span>
                    <span className="v">{money(cov.savings)}</span>
                    <span className="s">
                      {percent(cov.savingsPercent)} on decided products
                    </span>
                  </div>
                  <div className="wi-stat">
                    <span className="k">
                      {filtered ? "Flags in this slice" : "Guardrails outside range"}
                    </span>
                    <span className={breaches.length ? "v is-warn" : "v"}>
                      {breaches.length}
                    </span>
                    <span className="s">of {coo.length} regions</span>
                  </div>
                </div>
              </div>

              {/* Why progress leads: every guardrail below is a share of the
                  dollars actually placed, so how much is placed decides how
                  much those shares mean. */}
              {cov.shareDecided < 0.95 || cov.notInPlayStyles > 0 ? (
                <div className="bar bar--info wi-caveat">
                  <Icon name="info_circle" />
                  <div>
                    <strong>
                      Every guardrail below is a share of placed dollars only.
                    </strong>{" "}
                    {cov.shareDecided < 0.95 ? (
                      <>
                        {percent(1 - cov.shareDecided)} of biddable value is
                        still undecided and can move them.{" "}
                      </>
                    ) : null}
                    {cov.notInPlayStyles > 0 ? (
                      <>
                        Products not yet out to bid are excluded — they are not a
                        decision anyone is withholding.
                      </>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {/* 2 — GUARDRAILS, breaches first and clickable. */}
          <div className="card">
            <div className="card-h">
              <div className="ttl">Country of origin</div>
              <div className="sub">
                Share of placed dollars against each region&rsquo;s range
              </div>
            </div>
            <div className="card-b">
              {breaches.length ? (
                <div className="wi-breach-list">
                  {breaches.map((c) => (
                    <button
                      className="wi-breach"
                      key={c.region}
                      // Clicking a breach lands on the styles responsible —
                      // the Build Doc's requirement, and the difference between
                      // a number and something you can act on.
                      onClick={() =>
                        // `from` and `reason` let the destination say WHY it is
                        // filtered and offer a way back.
                        router.push(
                          `/award?cooRegion=${c.region}&from=insights&reason=${encodeURIComponent(
                            `${c.overMax ? "over max" : "under min"} by ${c.gapPoints?.toFixed(1)}pt`,
                          )}`,
                        )
                      }
                    >
                      <Badge tone={filtered ? "warning" : c.overMax ? "danger" : "warning"}>
                        {filtered
                          ? `Flag · ${c.overMax ? "over max" : "under min"}`
                          : c.overMax
                            ? "Over max"
                            : "Under min"}
                      </Badge>
                      <span className="wi-breach-text">
                        <strong>{c.region}</strong> is at {percent(c.share)},{" "}
                        {c.overMax ? "above" : "below"} its{" "}
                        {percent(c.overMax ? c.max : c.min, 0)}{" "}
                        {c.overMax ? "maximum" : "minimum"} by{" "}
                        {c.gapPoints?.toFixed(1)} points
                      </span>
                      <Icon name="arrow_right" size="sm" />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="bar bar--success">
                  <Icon name="check" />
                  <div>
                    <strong>Every region is inside its range.</strong>
                  </div>
                </div>
              )}

              <RangeBars
                data={coo.map((c) => ({
                  label: c.region,
                  value: c.share,
                  min: c.min,
                  max: c.max,
                  overMax: c.overMax,
                  underMin: c.underMin,
                  valueLabel: percent(c.share),
                  detail: c.gapPoints ? `${c.gapPoints.toFixed(1)}pt` : undefined,
                }))}
              />

              {data.guardrails.unclassifiedDollars > 0 ? (
                <div className="bar bar--warning" style={{ marginBlockStart: "var(--space-md)" }}>
                  <Icon name="alert_triangle" />
                  <div>
                    <strong>
                      {money(data.guardrails.unclassifiedDollars)} carries no
                      declared country.
                    </strong>{" "}
                    It is excluded from every share above rather than silently
                    bucketed — including it would move a threshold on a fiction.
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="wi-two-up">
            {/* 3 — VENDOR TYPE SPLIT */}
            <div className="card">
              <div className="card-h">
                <div className="ttl">Vendor type</div>
                <div className="sub">Award dollars by type</div>
              </div>
              <div className="card-b wi-donut-row">
                <Donut
                  slices={typeSlices}
                  centerLabel={money(typeTotal)}
                  centerSub="placed"
                />
                <div className="wi-legend">
                  {typeSlices.map((s) => (
                    <div className="wi-legend-row" key={s.label}>
                      <span
                        className="chart-swatch"
                        style={{ background: s.color }}
                        aria-hidden="true"
                      />
                      <span className="n">{s.label}</span>
                      {/* NOT `.v` — the design system defines `.card .v` as a
                          metric-pair value at heading-2 size, which is right for
                          a headline figure and wrong for a legend row. Using it
                          here rendered the legend larger than the chart it was
                          labelling. */}
                      <span className="d">{money(s.value)}</span>
                      <span className="p">
                        {percent(typeTotal ? s.value / typeTotal : 0, 0)}
                      </span>
                    </div>
                  ))}
                  {typeSlices.length === 0 ? (
                    <p className="wi-empty">Nothing allocated yet.</p>
                  ) : null}
                </div>
              </div>
            </div>

            {/* 4 — STYLES TAKING INCREASES */}
            <div className="card">
              <div className="card-h">
                <div className="ttl">
                  Products taking a cost increase
                  {data.stylesTakingIncrease.length > 0
                    ? ` (${data.stylesTakingIncrease.length})`
                    : ""}
                </div>
                <div className="sub">
                  Allocated above their landed baseline
                </div>
              </div>
              <div className="card-b">
                {data.stylesTakingIncrease.length ? (
                  <div className="wi-increase-list wi-scroll">
                    {data.stylesTakingIncrease.map((s) => (
                      <button
                        className="wi-increase"
                        key={s.styleId}
                        onClick={() =>
                          router.push(
                            `/award?q=${s.styleNumber}&from=insights&reason=${encodeURIComponent("taking a cost increase")}`,
                          )
                        }
                      >
                        <span className="wi-increase-id">
                          <span className="id">{s.styleNumber}</span>
                          <span className="n">{s.styleName}</span>
                          <span className="m">
                            {s.vendorNames.length > 1
                              ? `${s.vendorNames.length} vendors · ${s.vendorNames.join(", ")}`
                              : s.vendorNames[0]}
                          </span>
                        </span>
                        <span className="wi-increase-v">
                          +{money(s.increaseDollars)}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="empty compact">
                    <span className="glyph">
                      <Icon name="check" size="lg" />
                    </span>
                    <div className="ttl">No increases</div>
                    <div className="desc">
                      Every allocated product is at or below its baseline.
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 5 — VENDOR ROLLUP */}
          <div className="card">
            <div className="card-h">
              <div className="ttl">
                Vendor spend
                {data.guardrails.vendors.length
                  ? ` (${data.guardrails.vendors.length})`
                  : ""}
              </div>
              <div className="sub">
                Per vendor in total across every product, against their cap ·
                click a vendor for what they won
              </div>
            </div>
            <div className="card-b">
              {vendorBreaches.length ? (
                <div className="bar bar--danger" style={{ marginBlockEnd: "var(--space-md)" }}>
                  <Icon name="alert_triangle" />
                  <div>
                    <strong>
                      {vendorBreaches.length} vendor
                      {vendorBreaches.length === 1 ? " is" : "s are"} over cap.
                    </strong>{" "}
                    {vendorBreaches.map((v) => v.vendorName).join(", ")}
                  </div>
                </div>
              ) : null}

              {/* N15 — the legend carries the incumbency totals; there is no
                  separate incumbency chart. */}
              <div className="wi-caplegend" aria-label="What the bar colours mean">
                <span>
                  <span className="wi-caplegend-sw is-incumbent" />
                  Incumbent {money(data.guardrails.incumbencyTotals.incumbent)}
                </span>
                <span>
                  <span className="wi-caplegend-sw is-existing" />
                  Existing {money(data.guardrails.incumbencyTotals.existing)}
                </span>
                <span>
                  <span className="wi-caplegend-sw is-new" />
                  New {money(data.guardrails.incumbencyTotals.new)}
                </span>
              </div>

              {/* Search, because a 38-row table is a list you scan rather than
                  read, and the question is usually about ONE vendor. */}
              <div className="aw-filters">
                <div className="control search sm aw-search">
                  <Icon name="search" size="sm" />
                  <input
                    placeholder="Search vendors"
                    aria-label="Search vendors by name"
                    value={vendorQuery}
                    onChange={(e) => setVendorQuery(e.target.value)}
                  />
                </div>
                <span className="aw-filter-count">
                  {vendorRows.length} of {data.guardrails.vendors.length} vendors
                </span>
              </div>

              <div className="data-grid-surface wi-scroll">
                <table className="data-grid">
                  <colgroup>
                    <col style={{ width: "30%" }} />
                    <col style={{ width: "14%" }} />
                    <col style={{ width: "26%" }} />
                    <col style={{ width: "15%" }} />
                    <col style={{ width: "15%" }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Vendor</th>
                      <th>Type</th>
                      <th>Against cap</th>
                      <th className="num">Placed</th>
                      <th className="num">Headroom</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vendorRows.map((v) => (
                      <tr
                        key={v.vendorId}
                        className="vm-row"
                        onClick={() => setOpenVendorId(v.vendorId)}
                        tabIndex={0}
                        role="button"
                        aria-label={`What ${v.vendorName} won`}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setOpenVendorId(v.vendorId);
                          }
                        }}
                      >
                        <td>{v.vendorName}</td>
                        <td>
                          {v.isNewToQuince ? (
                            <span className="vl-type">New</span>
                          ) : (
                            <span className="vl-type">Existing</span>
                          )}
                        </td>
                        <td>
                          <SplitCapBar
                            split={v.split}
                            cap={v.cap}
                            breached={v.waveBreached}
                            wave={
                              filtered && Math.abs(v.waveDollars - v.dollars) > 0.5
                                ? v.waveDollars
                                : undefined
                            }
                          />
                        </td>
                        <td className="num">
                          {money(v.dollars)}
                          {/* The wave-wide figure the cap is judged on, when
                              the slice is only part of it (N16). */}
                          {filtered && Math.abs(v.waveDollars - v.dollars) > 0.5 ? (
                            <span className="wi-wave-note">
                              {money(v.waveDollars)} wave-wide
                            </span>
                          ) : null}
                        </td>
                        <td className="num">
                          {v.waveBreached ? (
                            <span className="aw-neg">
                              {money(v.waveDollars - v.cap)} over
                            </span>
                          ) : (
                            money(v.cap - v.waveDollars)
                          )}
                        </td>
                      </tr>
                    ))}
                    {vendorRows.length === 0 ? (
                      <tr>
                        <td colSpan={5}>
                          <div className="empty compact">
                            <span className="glyph">
                              <Icon name="users" size="lg" />
                            </span>
                            <div className="ttl">
                              {data.guardrails.vendors.length
                                ? "No vendor matches"
                                : "No vendor spend yet"}
                            </div>
                            <div className="desc">
                              {data.guardrails.vendors.length
                                ? "Try a different search."
                                : "Allocate a product and its vendors appear here."}
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <VendorAwardsDrawer
            vendor={openVendor}
            onClose={() => setOpenVendorId(null)}
          />
        </>
      ) : null}
    </>
  );
}

/**
 * What one vendor won — opened from the vendor spend table.
 *
 * Keyed on the vendor so a new selection never shows the previous vendor's
 * awards while the request is in flight. Only ONE drawer is ever open on this
 * screen: SideDrawer hardcodes `id="drawer-title"` and attaches a document
 * level Escape handler, so nesting would break focus and close both (T11).
 */
function VendorAwardsDrawer({
  vendor,
  onClose,
}: {
  vendor: VendorSpend | null;
  onClose: () => void;
}) {
  return (
    <VendorAwardsInner
      key={vendor?.vendorId ?? "none"}
      vendor={vendor}
      onClose={onClose}
    />
  );
}

type VendorAward = {
  styleId: string;
  styleNumber: string;
  styleName: string;
  heroImage: string | null;
  planUnits: number;
  awardPct: number;
  awardedUnits: number;
  awardedDollars: number;
  savingsDollars: number;
  status: string;
  baselineFob: number | null;
  baselineLanded: number | null;
  fob: number | null;
  bestCost: number | null;
  bestCostBasis: string | null;
  dutyType: string | null;
  ddp: {
    ocean: { west: number | null; central: number | null; east: number | null };
    air: { west: number | null; central: number | null; east: number | null };
  } | null;
};

type VendorAwards = {
  totals: {
    products: number;
    awardedDollars: number;
    awardedUnits: number;
    savingsDollars: number;
  };
  awards: VendorAward[];
};

const BASIS_LABEL: Record<string, string> = {
  QUINCE_BLEND: "Quince freight",
  DDP_BLEND: "DDP (highest dest.)",
};

function VendorAwardsInner({
  vendor,
  onClose,
}: {
  vendor: VendorSpend | null;
  onClose: () => void;
}) {
  const { data, loading } = useApi<VendorAwards>(
    vendor ? `/api/vendors/${vendor.vendorId}/awards` : null,
  );
  const [openDdp, setOpenDdp] = React.useState<string | null>(null);

  return (
    <SideDrawer
      open={vendor !== null}
      onClose={onClose}
      title={vendor?.vendorName ?? "Vendor"}
      sub={
        vendor
          ? `${vendor.isNewToQuince ? "New to Quince" : "Existing"} · ${money(vendor.dollars)} of ${money(vendor.cap)} cap`
          : undefined
      }
      size="lg"
    >
      {vendor ? (
        <>
          {vendor.breached ? (
            <div className="bar bar--danger">
              <Icon name="alert_triangle" />
              <div>
                <strong>Over their spend cap</strong> by{" "}
                {money(-vendor.headroom)}.
              </div>
            </div>
          ) : null}

          <div className="pg-baseline">
            <div className="pg-baseline-item">
              <span className="k">Products won</span>
              <span className="v">{data?.totals.products ?? 0}</span>
            </div>
            <div className="pg-baseline-item">
              <span className="k">Awarded</span>
              <span className="v">{money(data?.totals.awardedDollars ?? 0)}</span>
            </div>
            <div className="pg-baseline-item">
              <span className="k">Units</span>
              <span className="v">{units(data?.totals.awardedUnits ?? 0)}</span>
            </div>
            <div className="pg-baseline-item">
              <span className="k">Savings</span>
              <span className="v">{money(data?.totals.savingsDollars ?? 0)}</span>
            </div>
          </div>

          <div className="section">
            <div className="hd">What they won</div>

            {loading ? <div className="sk" style={{ blockSize: 160 }} /> : null}

            {!loading && (data?.awards.length ?? 0) === 0 ? (
              <div className="empty compact">
                <span className="glyph">
                  <Icon name="sku" size="lg" />
                </span>
                <div className="ttl">Nothing awarded yet</div>
                <div className="desc">
                  They have bid but no product has been allocated to them.
                </div>
              </div>
            ) : null}

            {(data?.awards ?? []).map((a) => (
              <div className="va-row" key={a.styleId}>
                <div className="va-head">
                  {a.heroImage ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img className="aw-thumb" src={a.heroImage} alt="" loading="lazy" />
                  ) : (
                    <span className="aw-thumb aw-thumb--empty" />
                  )}
                  <span className="va-id">
                    <span className="id">{a.styleNumber}</span>
                    <span className="va-name">{a.styleName}</span>
                  </span>
                  <span className="va-award">
                    <span className="pct">{a.awardPct}%</span>
                    <span className="d">{money(a.awardedDollars)}</span>
                  </span>
                </div>

                <dl className="va-facts">
                  <dt>Units</dt>
                  <dd>
                    {units(a.awardedUnits)} of {units(a.planUnits)}
                  </dd>
                  <dt>Their FOB</dt>
                  <dd>{unitCost(a.fob)}</dd>
                  <dt>Best cost</dt>
                  <dd>
                    {unitCost(a.bestCost)}
                    {a.bestCostBasis ? (
                      <span className="va-basis">
                        {BASIS_LABEL[a.bestCostBasis] ?? a.bestCostBasis}
                      </span>
                    ) : null}
                  </dd>
                  <dt>Baseline landed</dt>
                  <dd>{unitCost(a.baselineLanded)}</dd>
                  <dt>Savings</dt>
                  <dd className={a.savingsDollars < 0 ? "aw-neg" : undefined}>
                    {money(a.savingsDollars)}
                  </dd>
                </dl>

                {/* The grid behind the blend. Collapsed by default — it is the
                    evidence for a Best Cost, not the comparison itself. */}
                {a.ddp ? (
                  <>
                    <button
                      className="va-ddp-toggle"
                      onClick={() =>
                        setOpenDdp(openDdp === a.styleId ? null : a.styleId)
                      }
                      aria-expanded={openDdp === a.styleId}
                    >
                      <Icon
                        name={openDdp === a.styleId ? "chevron_up" : "chevron_down"}
                        size="sm"
                      />
                      DDP quoted{a.dutyType ? ` · ${a.dutyType}` : ""}
                    </button>

                    {openDdp === a.styleId ? (
                      <table className="va-ddp">
                        <thead>
                          <tr>
                            <th />
                            <th className="num">West</th>
                            <th className="num">Central</th>
                            <th className="num">East</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td>Ocean</td>
                            <td className="num">{unitCost(a.ddp.ocean.west)}</td>
                            <td className="num">{unitCost(a.ddp.ocean.central)}</td>
                            <td className="num">{unitCost(a.ddp.ocean.east)}</td>
                          </tr>
                          <tr>
                            <td>Air</td>
                            <td className="num">{unitCost(a.ddp.air.west)}</td>
                            <td className="num">{unitCost(a.ddp.air.central)}</td>
                            <td className="num">{unitCost(a.ddp.air.east)}</td>
                          </tr>
                        </tbody>
                      </table>
                    ) : null}
                  </>
                ) : a.dutyType ? (
                  <p className="va-noddp">
                    {a.dutyType === "QDDP"
                      ? "QDDP — Quince arranges freight, so no DDP was quoted."
                      : `${a.dutyType} — no DDP quoted.`}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </>
      ) : null}
    </SideDrawer>
  );
}
