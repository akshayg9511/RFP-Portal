"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Badge, Checkbox, Icon } from "@/ds/components";
import { useApi } from "@/lib/useApi";
import { moneyCompact, percent, unitCost, units } from "@/lib/format";
import { facetsOf } from "@/components/FacetSelect";
import type { BidGroup, BidSummary, CostMode, FlatRow, Modes } from "./types";
import { CostTipProvider, TipTarget } from "./CostTip";
import { BidDrawer } from "./BidDrawer";
import { BulkBar } from "./BulkBar";
import { FilterBar } from "@/components/FilterBar";
import { AwardOverlay } from "./AwardOverlay";

/**
 * BID SUMMARY — Phase 3, 5 Oct.
 *
 * Every bid across every RFP, one row per product x variant x vendor, grouped
 * under a header per product x variant (U1). Replaces the "flat grid inside
 * the RFP page" of the old plan: Akshay wanted ONE place to see bids across
 * every division and act on them.
 *
 * The business works from the Wave 1 "Bid Inputs" sheet (~3,000 rows), so the
 * price columns are the sheet's (U2) — Quince-paid ocean / air / blend and DDP
 * ocean / air / blend — made legible: grouped under two-tier headers, the
 * basis in use emphasised and the other receding, the variant's lowest
 * blended cost marked.
 */

type View = "review" | "notbid" | "unallocated" | "all";


const FREIGHT_LABEL = { QUINCE_BLEND: "Quince-paid", DDP_BLEND: "DDP" } as const;

/**
 * EVERY STAGE HAS A COLOUR, chosen by whose move it is.
 *
 * Untoned badges render with no fill, so "In negotiation" and "Invited" read
 * as stray text beside filled pills and the column looked misaligned — the
 * same defect the RFP list had with DRAFT (A12).
 *  - warning: Quince's turn — what this screen exists to surface
 *  - accent:  in progress with the vendor
 *  - info:    nothing back yet (the DS's "no status yet" grey)
 *  - success: done; danger (tinted, never solid): ended
 */
const STAGE_TONE: Record<string, "warning" | "accent" | "info" | "success" | "danger"> = {
  INITIAL_IN_REVIEW: "warning",
  FULL_IN_REVIEW: "warning",
  FINAL_IN_REVIEW: "warning",
  CHANGES_REQUESTED: "accent",
  INITIAL_CLEARED: "accent",
  IN_NEGOTIATION: "accent",
  FINAL_REQUESTED: "accent",
  INVITED: "info",
  BID_ACCEPTED: "success",
  NOT_PROCEEDING: "danger",
  // The DS has four status tones and no neutral one, so a vendor-side exit
  // takes the same grey as "nothing back yet".
  WITHDRAWN: "info",
};

export default function BidSummaryPage() {
  // useSearchParams() needs a Suspense boundary to prerender (A17).
  return (
    <React.Suspense fallback={<div className="sk" style={{ blockSize: 320 }} />}>
      <BidSummaryInner />
    </React.Suspense>
  );
}

function BidSummaryInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { data, loading, error, reload } = useApi<BidSummary>("/api/bid-summary");

  // ── filters, all in the URL (P12) ───────────────────────────────────────
  const view = (params.get("view") as View | null) ?? "review";
  // 14 — one freight mode at a time, and the landed sum opened for ALL
  // products at once (Akshay, 9 Oct). Both live in the URL like the filters.
  const mode = (["ocean", "air"].includes(params.get("mode") ?? "") ? params.get("mode") : "blend") as CostMode;
  const breakdown = params.get("lb") === "1";
  const get = (k: string) => params.get(k) ?? "";
  const f = {
    q: get("q"),
    division: get("division"),
    department: get("department"),
    subDepartment: get("subDepartment"),
    material: get("material"),
    colour: get("colour"),
    vendor: get("vendor"),
    country: get("country"),
    gm: get("gm"),
    partner: get("partner"),
    stage: get("stage"),
    freight: get("freight"),
  };
  function setParam(key: string, value: string) {
    setParams({ [key]: value });
  }
  function setParams(patch: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    const qs = next.toString();
    router.replace(qs ? `?${qs}` : "?", { scroll: false });
  }
  // "all" is explicit in the URL, because the DEFAULT is "review" — clearing
  // the chip must not snap straight back to it.
  const setView = (v: View) => setParam("view", v === "review" ? "" : v);
  const VIEW_LABEL: Record<View, string> = {
    review: "Awaiting review",
    notbid: "Not bid",
    unallocated: "Unallocated variants",
    all: "All bids",
  };

  const flat: FlatRow[] = React.useMemo(
    () =>
      (data?.groups ?? []).flatMap((group) =>
        group.rows.map((r) => ({ ...r, group, rowKey: `${group.key}|${r.invitationId}` })),
      ),
    [data],
  );

  const freightOf = (r: FlatRow) =>
    !r.price ? null : r.price.overridden ? "Overridden" : FREIGHT_LABEL[r.price.basis];

  /** Every filter except `skip` — so a facet never zeroes its own options. */
  const matches = React.useCallback(
    (r: FlatRow, skip?: string) => {
      const g = r.group;
      const q = f.q.trim().toLowerCase();
      return (
        (skip === "q" || !q ||
          `${g.styleNumber} ${g.name} ${r.vendor.name}`.toLowerCase().includes(q)) &&
        (skip === "division" || !f.division || g.division === f.division) &&
        (skip === "department" || !f.department || g.department === f.department) &&
        (skip === "subDepartment" || !f.subDepartment || g.subDepartment === f.subDepartment) &&
        (skip === "material" || !f.material || g.material === f.material) &&
        (skip === "colour" || !f.colour || g.colours.includes(f.colour)) &&
        (skip === "vendor" || !f.vendor || r.vendor.name === f.vendor) &&
        (skip === "country" || !f.country || r.vendor.countryIso === f.country) &&
        (skip === "gm" || !f.gm || r.rfp.gm === f.gm) &&
        (skip === "partner" || !f.partner || r.rfp.sourcingPartner === f.partner) &&
        (skip === "stage" || !f.stage || r.stage.quinceLabel === f.stage) &&
        (skip === "freight" || !f.freight || freightOf(r) === f.freight)
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [params],
  );

  const inView = React.useCallback(
    (r: FlatRow) =>
      view === "all"
        ? true
        : view === "review"
          ? r.hasBid && r.stage.awaitingReview
          : view === "notbid"
            ? !r.hasBid
            : // Unallocated is a VARIANT property: show every row of a variant
              // that has bids but is not yet at 100%.
              !r.group.allocated && r.group.rows.some((x) => x.hasBid),
    [view],
  );

  const visible = React.useMemo(
    () => flat.filter((r) => matches(r) && inView(r)),
    [flat, matches, inView],
  );

  // Re-assemble groups from the visible rows, keeping server order.
  const groups = React.useMemo(() => {
    const byKey = new Map<string, { group: BidGroup; rows: FlatRow[] }>();
    for (const r of visible) {
      const cur = byKey.get(r.group.key) ?? { group: r.group, rows: [] };
      cur.rows.push(r);
      byKey.set(r.group.key, cur);
    }
    return [...byKey.values()];
  }, [visible]);

  const facets = React.useMemo(() => {
    const pool = (dim: string) => flat.filter((r) => matches(r, dim) && inView(r));
    return {
      division: facetsOf(pool("division"), (r) => r.group.division),
      department: facetsOf(pool("department"), (r) => r.group.department),
      subDepartment: facetsOf(pool("subDepartment"), (r) => r.group.subDepartment),
      material: facetsOf(pool("material"), (r) => r.group.material),
      colour: facetsOf(pool("colour"), (r) => r.group.colours),
      vendor: facetsOf(pool("vendor"), (r) => r.vendor.name),
      country: facetsOf(pool("country"), (r) => r.vendor.countryIso),
      gm: facetsOf(pool("gm"), (r) => r.rfp.gm),
      partner: facetsOf(pool("partner"), (r) => r.rfp.sourcingPartner),
      stage: facetsOf(pool("stage"), (r) => r.stage.quinceLabel),
      freight: facetsOf(pool("freight"), (r) => freightOf(r)),
    };
  }, [flat, matches, inView]);

  // Counts for the quick views, under every OTHER filter. "Unallocated" is a
  // VARIANT property, so it counts variants — counting their rows would read
  // as "21 unallocated" for 5 sizes with four vendors each.
  const viewCount = (v: View) =>
    v === "unallocated"
      ? new Set(
          flat
            .filter((r) => matches(r) && !r.group.allocated && r.group.rows.some((x) => x.hasBid))
            .map((r) => r.group.key),
        ).size
      : flat.filter(
      (r) =>
        matches(r) &&
        (v === "review"
          ? r.hasBid && r.stage.awaitingReview
          : v === "notbid"
            ? !r.hasBid
            : !r.group.allocated && r.group.rows.some((x) => x.hasBid)),
    ).length;

  // ── collapse + selection ────────────────────────────────────────────────
  // Collapsed by default (Akshay, 5 Oct) — the list opens as one line per
  // product x variant, and a variant expands on click. So track EXPANDED.
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const toggleCollapse = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const toggleRow = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const anyFilter = Object.entries(f).some(([, v]) => v);

  /**
   * THE OPEN BID — in the URL (`?bid=`), so a link opens straight onto it.
   * Previous / next walk the visible list in its displayed order (U6).
   */
  const openKey = params.get("bid");
  const openRow = flat.find((r) => r.rowKey === openKey) ?? null;
  const order = visible;
  const idx = openRow ? order.findIndex((r) => r.rowKey === openRow.rowKey) : -1;
  const openBid = (r: FlatRow | null) => setParam("bid", r ? r.rowKey : "");

  /**
   * THE ALLOCATE OVERLAY — also in the URL (`?alloc=&av=`), so browser Back
   * closes it and a link opens straight onto it. The open bid (`?bid=`) is
   * KEPT while it is up and the drawer simply yields (T11: one modal surface
   * at a time), so closing the overlay lands back on the bid you came from.
   */
  const allocStyle = params.get("alloc");
  const allocVar = params.get("av");
  const allocGroup = allocStyle ? flat.find((r) => r.group.styleId === allocStyle)?.group ?? null : null;
  const openAllocate = (g: BidGroup) => setParams({ alloc: g.styleId, av: g.variationId ?? "" });
  const closeAllocate = React.useCallback(() => setParams({ alloc: "", av: "" }), [params]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Bid summary as it stands, minus the overlay — filters, open bid and all. */
  const closeHref = (() => {
    const back = new URLSearchParams(params.toString());
    back.delete("alloc");
    back.delete("av");
    return `/bid-summary${back.toString() ? `?${back}` : ""}`;
  })();
  /** The full page, told to come BACK to exactly that. */
  const fullPageHref = (() => {
    if (!allocStyle) return "";
    const q = new URLSearchParams();
    if (allocVar) q.set("v", allocVar);
    q.set("back", closeHref);
    return `/products/${allocStyle}/award?${q}`;
  })();
  // The same vendor on EVERY variant of this product, regardless of filters —
  // "the ability to look at other variants of the same product" (P7).
  const siblings = openRow
    ? flat.filter(
        (r) => r.invitationId === openRow.invitationId && r.group.styleId === openRow.group.styleId,
      )
    : [];

  if (loading && !data) {
    return (
      <>
        <div className="page-hd"><h1>Bid summary</h1></div>
        <div className="sk" style={{ blockSize: 360 }} />
      </>
    );
  }

  return (
    <>
      <div className="page-hd">
        <h1>Bid summary</h1>
      </div>

      {error ? (
        <div className="bar bar--danger">
          <Icon name="alert_triangle" />
          <div><strong>Bids could not be loaded.</strong> {error}</div>
        </div>
      ) : null}

      {data ? (
        <>
          {/* Filter & sort pattern (Aravind, C27): search, the ONE "Show"
              control (Akshay, 5 Oct), and the other eleven filters in the
              More filters side panel — they used to take three rows. */}
          <FilterBar
            search={{ value: f.q, onChange: (v) => setParam("q", v), placeholder: "Search product or vendor" }}
            facet={{
              label: "view",
              placeholder: "Show",
              value: view,
              onChange: (v) => setView((v || "review") as View),
              options: (["review", "notbid", "unallocated", "all"] as View[]).map((v) => ({
                value: v,
                count: v === "all" ? flat.filter((r) => matches(r)).length : viewCount(v),
              })),
              format: (v) => VIEW_LABEL[v as View] ?? v,
            }}
            groups={[
              { key: "division", label: "Division", single: true, options: facets.division, selected: f.division ? [f.division] : [] },
              { key: "department", label: "Department", single: true, options: facets.department, selected: f.department ? [f.department] : [] },
              { key: "subDepartment", label: "Sub-department", single: true, options: facets.subDepartment, selected: f.subDepartment ? [f.subDepartment] : [] },
              { key: "vendor", label: "Vendor", single: true, options: facets.vendor, selected: f.vendor ? [f.vendor] : [] },
              { key: "stage", label: "Stage", single: true, options: facets.stage, selected: f.stage ? [f.stage] : [] },
              { key: "material", label: "Material", single: true, options: facets.material, selected: f.material ? [f.material] : [] },
              { key: "colour", label: "Colour", single: true, options: facets.colour, selected: f.colour ? [f.colour] : [] },
              { key: "country", label: "Country", single: true, options: facets.country, selected: f.country ? [f.country] : [] },
              { key: "gm", label: "GM", single: true, options: facets.gm, selected: f.gm ? [f.gm] : [] },
              { key: "partner", label: "Sourcing partner", single: true, options: facets.partner, selected: f.partner ? [f.partner] : [] },
              { key: "freight", label: "Freight", single: true, options: facets.freight, selected: f.freight ? [f.freight] : [] },
            ]}
            onGroupsChange={(next) =>
              setParams(Object.fromEntries(['division', 'department', 'subDepartment', 'vendor', 'stage', 'material', 'colour', 'country', 'gm', 'partner', 'freight'].map((k) => [k, next[k]?.[0] ?? ""])))
            }
          />

          {groups.length === 0 ? (
            <div className="card">
              <div className="card-b">
                <div className="empty">
                  <span className="glyph"><Icon name="check_circle" size="lg" /></span>
                  <div className="ttl">
                    {view === "review" && !anyFilter ? "Nothing awaiting review" : "No bids match"}
                  </div>
                  <div className="desc">
                    {view === "review" && !anyFilter
                      ? "Every submitted bid has been acted on. Clear the view to see all bids."
                      : "Try clearing a filter or the quick view."}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <CostTipProvider>
            <div className="bs-toolbar">
              <div className="seg" role="group" aria-label="Freight mode">
                {(["blend", "ocean", "air"] as CostMode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={mode === m ? "on" : undefined}
                    aria-pressed={mode === m}
                    onClick={() => setParam("mode", m === "blend" ? "" : m)}
                  >
                    {MODE_LABEL[m]}
                  </button>
                ))}
              </div>
              <span className="bs-toolbar-note">
                {mode === "blend"
                  ? "Blend uses each variant's air / ocean split."
                  : `Unit costs shown by ${mode}. Savings / yr stays on the blend.`}
              </span>
              <button
                type="button"
                className="btn btn--ghost sm bs-toolbar-end"
                aria-pressed={breakdown}
                onClick={() => setParam("lb", breakdown ? "" : "1")}
              >
                <Icon name={breakdown ? "chevron_left" : "chevron_right"} size="sm" />
                {breakdown ? "Hide landed breakdown" : "Show landed breakdown"}
              </button>
            </div>
            <div className="data-grid-surface bs-scroll">
              <table className={`data-grid bs-grid${breakdown ? " is-breakdown" : ""}`}>
                <thead>
                  <tr>
                    <th className="bs-sticky bs-c-check" aria-label="Select" />
                    <th className="bs-sticky bs-c-product">Product</th>
                    <th className="bs-sticky bs-c-vendor">Vendor · COO</th>
                    <th className="num">FOB</th>
                    {breakdown ? (
                      <>
                        <th className="num bs-sum"><span className="bs-op" aria-hidden>+</span>Tariff</th>
                        <th className="num bs-sum"><span className="bs-op" aria-hidden>+</span>Logistics</th>
                      </>
                    ) : null}
                    <th className={`num${breakdown ? " bs-sum bs-sum-end" : ""}`}>
                      <button
                        type="button"
                        className="bs-th-btn"
                        aria-expanded={breakdown}
                        title={breakdown ? "Hide the landed breakdown" : "Show FOB + tariff + logistics"}
                        onClick={() => setParam("lb", breakdown ? "" : "1")}
                      >
                        {breakdown ? <span className="bs-op" aria-hidden>=</span> : null}
                        Landed
                        <Icon name={breakdown ? "chevron_left" : "chevron_right"} size="sm" />
                      </button>
                    </th>
                    <th className="num">DDP</th>
                    <th className="num">Best</th>
                    <th className="num">vs current</th>
                    <th className="num">Savings / yr</th>
                    <th className="num">Award</th>
                    <th>Stage</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map(({ group, rows }) => (
                    <GroupRows
                      key={group.key}
                      group={group}
                      rows={rows}
                      collapsed={!expanded.has(group.key)}
                      onToggle={() => toggleCollapse(group.key)}
                      selected={selected}
                      onSelect={toggleRow}
                      onChanged={reload}
                      onOpen={openBid}
                      onAllocate={openAllocate}
                      openKey={openKey}
                      mode={mode}
                      breakdown={breakdown}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            </CostTipProvider>
          )}

          <BidDrawer
            row={allocStyle ? null : openRow}
            siblings={siblings}
            onClose={() => openBid(null)}
            onPrev={idx > 0 ? () => openBid(order[idx - 1]!) : undefined}
            onNext={idx >= 0 && idx < order.length - 1 ? () => openBid(order[idx + 1]!) : undefined}
            onSelect={openBid}
            onAllocate={openAllocate}
            onChanged={reload}
          />

          <AwardOverlay
            styleId={allocStyle}
            variationId={allocVar}
            title={allocGroup ? `Allocate · ${allocGroup.styleNumber}` : "Allocate"}
            fullPageHref={fullPageHref}
            closeHref={closeHref}
            onSelectVariation={(id) => setParam("av", id ?? "")}
            onClose={closeAllocate}
            onChanged={reload}
          />

          {/* P10 — the selection bar, only while something is ticked. Rows
              that left the list after a move drop out of it too. */}
          <BulkBar
            rows={flat.filter((r) => selected.has(r.rowKey))}
            onClear={() => setSelected(new Set())}
            onDone={reload}
          />
        </>
      ) : null}
    </>
  );
}

const MODE_LABEL: Record<CostMode, string> = { blend: "Blend", ocean: "Ocean", air: "Air" };

type Price = NonNullable<FlatRow["price"]>;

/**
 * Best cost in one freight mode. Blend keeps the basis in use, overrides
 * included. Ocean and air take whichever is cheaper in that mode, landed or
 * DDP, which can differ from the blend's winner.
 */
function bestIn(p: Price, mode: CostMode): { value: number; ddp: boolean } {
  if (mode === "blend") return { value: p.bestCost, ddp: p.basis === "DDP_BLEND" };
  const landed = p.quincePaid[mode];
  const ddp = p.ddp?.[mode] ?? null;
  return ddp !== null && ddp < landed ? { value: ddp, ddp: true } : { value: landed, ddp: false };
}

function signedPct(v: number | null) {
  if (v === null) return "—";
  return (
    <span className={v > 0 ? "aw-neg" : "aw-pos"}>
      {v > 0 ? "+" : ""}
      {(v * 100).toFixed(1)}%
    </span>
  );
}

function GroupRows({
  group,
  rows,
  collapsed,
  onToggle,
  selected,
  onSelect,
  onChanged,
  onOpen,
  onAllocate,
  openKey,
  mode,
  breakdown,
}: {
  group: BidGroup;
  rows: FlatRow[];
  collapsed: boolean;
  onToggle: () => void;
  selected: Set<string>;
  onSelect: (key: string) => void;
  /** Refetch after a write — never a full page reload, which loses scroll. */
  onChanged: () => void;
  onOpen: (row: FlatRow) => void;
  onAllocate: (group: BidGroup) => void;
  openKey: string | null;
  mode: CostMode;
  breakdown: boolean;
}) {
  const [details, setDetails] = React.useState(false);
  const cols = breakdown ? 13 : 11;
  const bids = rows.filter((r) => r.hasBid).length;
  const awaiting = rows.filter((r) => r.hasBid && r.stage.awaitingReview).length;
  const bests = rows.filter((r) => r.price).map((r) => bestIn(r.price!, mode).value);
  const lowest = bests.length ? Math.min(...bests) : null;
  const inp = group.inputs;
  const dims =
    inp.lengthIn && inp.widthIn && inp.heightIn
      ? `${inp.lengthIn.toFixed(1)} × ${inp.widthIn.toFixed(1)} × ${inp.heightIn.toFixed(1)} in`
      : null;

  return (
    <>
      {/* THE VARIANT HEADER (U1). Baseline and current landed lead; every
          other input sits behind Details (Akshay, 9 Oct: not P0). */}
      <tr className="bs-group">
        <td colSpan={cols}>
          <div className="bs-group-in">
            <button
              type="button"
              className="aw-chev"
              aria-expanded={!collapsed}
              aria-label={`${collapsed ? "Show" : "Hide"} vendors for ${group.styleNumber} ${group.variationLabel}`}
              onClick={onToggle}
            >
              <Icon name={collapsed ? "chevron_right" : "chevron_down"} size="sm" />
            </button>
            <span className="bs-group-id">
              <span className="id">{group.styleNumber}</span>
              <span className="bs-group-name">{group.name}</span>
              <span className="bs-group-var">{group.variationLabel}</span>
            </span>
            <span className="bs-fact">
              Baseline PCOGS <strong>{group.baselinePcogs ? unitCost(group.baselinePcogs) : "—"}</strong>
            </span>
            <span className="bs-fact">
              Current landed{" "}
              <TipTarget
                tip={
                  <CurrentTip
                    c={group.current}
                    pcogs={group.baselinePcogs}
                    rate={inp.tariffRate}
                    logistics={inp.logistics}
                    iso={group.current.countryIso}
                    mode={mode}
                  />
                }
              >
                <strong>{unitCost(group.current[mode])}</strong>
              </TipTarget>
              {group.current.countryIso ? <span className="bs-fact-meta"> at {group.current.countryIso}</span> : null}
            </span>
            {collapsed ? (
              <span className="bs-fact">
                {bids} bid{bids === 1 ? "" : "s"}
                {lowest !== null ? ` · best ${unitCost(lowest)}` : ""}
                {awaiting ? (
                  <>
                    {" · "}
                    <strong className="bs-await">{awaiting} awaiting review</strong>
                  </>
                ) : null}
              </span>
            ) : null}
            <button
              type="button"
              className="btn btn--ghost sm"
              aria-expanded={details}
              onClick={() => setDetails((v) => !v)}
            >
              Details
              <Icon name={details ? "chevron_up" : "chevron_down"} size="sm" />
            </button>
            <span className="bs-group-alloc">
              <Badge tone={group.allocated ? "success" : undefined}>
                {group.allocated ? "Allocated" : `${Math.round(group.allocatedPct)}% allocated`}
              </Badge>
              {/* P8 — allocation happens in ONE place, opened on this size,
                  now as an overlay so Bid summary stays underneath. */}
              <button type="button" className="btn btn--ghost sm" onClick={() => onAllocate(group)}>
                Allocate
              </button>
            </span>
          </div>
        </td>
      </tr>

      {details ? (
        <tr className="bs-details">
          <td colSpan={cols}>
            <dl className="bs-dl">
              <div><dt>Plan units</dt><dd>{units(group.planUnits)} / yr</dd></div>
              <div><dt>COO (incumbent)</dt><dd>{inp.countryIso ?? "—"}</dd></div>
              <div><dt>HTS</dt><dd className={inp.htsCode ? undefined : "bs-missing"}>{inp.htsCode ?? "Missing"}</dd></div>
              <div><dt>Dimensions</dt><dd className={dims ? undefined : "bs-missing"}>{dims ?? "Missing"}</dd></div>
              <div><dt>Weight</dt><dd className={inp.weightG ? undefined : "bs-missing"}>{inp.weightG ? `${units(inp.weightG)} g` : "Missing"}</dd></div>
              <div><dt>Tariff{inp.countryIso ? ` · ${inp.countryIso}` : ""}</dt><dd>{inp.htsCode ? percent(inp.tariffRate) : "—"}</dd></div>
              <div><dt>Logistics / unit</dt><dd>Ocean {unitCost(inp.logistics.ocean)} · Air {unitCost(inp.logistics.air)}</dd></div>
              <div><dt>Freight split</dt><dd><SplitEditor group={group} onSaved={onChanged} /></dd></div>
            </dl>
          </td>
        </tr>
      ) : null}

      {collapsed
        ? null
        : rows.map((r) => (
            <BidRowView
              key={r.rowKey}
              row={r}
              lowest={lowest}
              checked={selected.has(r.rowKey)}
              onCheck={() => onSelect(r.rowKey)}
              onOpen={() => onOpen(r)}
              isOpen={openKey === r.rowKey}
              mode={mode}
              breakdown={breakdown}
            />
          ))}
    </>
  );
}

function BidRowView({
  row,
  lowest,
  checked,
  onCheck,
  onOpen,
  isOpen,
  mode,
  breakdown,
}: {
  row: FlatRow;
  lowest: number | null;
  checked: boolean;
  onCheck: () => void;
  onOpen: () => void;
  isOpen: boolean;
  mode: CostMode;
  breakdown: boolean;
}) {
  const p = row.price;
  const stageTone = STAGE_TONE[row.stage.status] ?? "info";
  const best = p ? bestIn(p, mode) : null;
  const isLowest = best !== null && lowest !== null && Math.abs(best.value - lowest) < 1e-9;
  const cur = p ? p.current[mode] : 0;
  const delta = p && cur ? (best!.value - cur) / cur : null;
  const ddp = p?.ddp?.[mode] ?? null;
  const iso = row.vendor.countryIso;
  const otherCoo = iso !== null && row.group.current.countryIso !== null && iso !== row.group.current.countryIso;
  const typeLabel = row.vendor.type === "NEW" ? "New" : row.vendor.type === "INCUMBENT" ? "Incumbent" : "Existing";

  return (
    <tr
      className={`bs-row${row.hasBid ? "" : " is-nobid"}${isOpen ? " is-open" : ""}`}
      onClick={onOpen}
      tabIndex={0}
      role="button"
      aria-label={`Open ${row.vendor.name}'s bid on ${row.group.styleNumber} ${row.group.variationLabel}`}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <td className="bs-sticky bs-c-check" onClick={(e) => e.stopPropagation()}>
        <Checkbox checked={checked} onChange={onCheck} aria-label={`Select ${row.vendor.name}`} />
      </td>
      {/* PRODUCT on every row (Akshay, 5 Oct). */}
      <td className="bs-sticky bs-c-product">
        <span className="id">{row.group.styleNumber}</span>
        <span className="bs-vendor-meta">{row.group.variationLabel}</span>
      </td>
      <td className="bs-sticky bs-c-vendor">
        <span className="bs-vendor">{row.vendor.name}</span>
        <span className="bs-vendor-meta">{iso ?? "—"} · {typeLabel}</span>
      </td>

      {p && best ? (
        <>
          <td className="num">{unitCost(p.fob)}</td>
          {breakdown ? (
            <>
              <td className="num bs-sum">
                {unitCost(p.tariff)}
                <span className="bs-vendor-meta">{percent(p.tariffRate)}</span>
              </td>
              <td className="num bs-sum">
                {unitCost(p.logistics[mode])}
                <span className="bs-vendor-meta">{mode === "blend" ? `air ${row.group.split.airPct}%` : MODE_LABEL[mode].toLowerCase()}</span>
              </td>
            </>
          ) : null}
          <td className={`num${breakdown ? " bs-sum bs-sum-end" : ""} ${best.ddp ? "bs-muted" : "bs-used"}`}>
            <TipTarget tip={<LandedTip p={p} mode={mode} airPct={row.group.split.airPct} />}>
              {unitCost(p.quincePaid[mode])}
            </TipTarget>
          </td>
          <td className={`num ${best.ddp ? "bs-used" : "bs-muted"}`}>
            {ddp === null ? "—" : (
              <TipTarget tip={<DdpTip p={p} mode={mode} />}>{unitCost(ddp)}</TipTarget>
            )}
          </td>
          <td className="num">
            {unitCost(best.value)}
            <span className="bs-basis">{best.ddp ? "DDP" : "Landed"}</span>
            <BasisMark lowest={isLowest} overridden={mode === "blend" && p.overridden} />
          </td>
          <td className="num">
            <TipTarget
              tip={
                <CurrentTip
                  c={p.current}
                  pcogs={row.group.baselinePcogs}
                  rate={p.tariffRate}
                  logistics={p.logistics}
                  iso={p.current.countryIso}
                  mode={mode}
                />
              }
            >
              {signedPct(delta)}
            </TipTarget>
            {otherCoo ? <span className="bs-vendor-meta">vs current at {iso}</span> : null}
          </td>
          <td className="num">
            <span className={p.annualSavings < 0 ? "aw-neg" : undefined}>{moneyCompact(p.annualSavings)}</span>
          </td>
        </>
      ) : (
        <td colSpan={breakdown ? 8 : 6} className="bs-nobid-cell">
          {row.notIssued
            ? "Not issued yet — the RFP is still a draft"
            : row.cannotBid
              ? "Not able to quote"
              : "Not bid yet"}
        </td>
      )}

      <td className="num">
        {row.award ? (
          <>
            {Math.round(row.award.pct)}%
            <span className="bs-vendor-meta">{moneyCompact(row.award.dollars)}</span>
          </>
        ) : "—"}
      </td>
      <td>
        {/* `accent` is a flag on Badge, not a tone. */}
        <Badge tone={stageTone === "accent" ? undefined : stageTone} accent={stageTone === "accent"}>
          {row.stage.quinceLabel}
        </Badge>
      </td>
    </tr>
  );
}

/* ── hover cards ─────────────────────────────────────────────────────────── */

function ModeGrid({ values, mode }: { values: { ocean: number | null; air: number | null; blend: number | null }; mode: CostMode }) {
  return (
    <div className="bs-tip-modes">
      {(["ocean", "air", "blend"] as CostMode[]).map((m) => (
        <div key={m} className={m === mode ? "on" : undefined}>
          <span>{MODE_LABEL[m]}</span>
          <strong>{values[m] === null ? "—" : unitCost(values[m])}</strong>
        </div>
      ))}
    </div>
  );
}

function Equation({ lines }: { lines: [string, string, number][] }) {
  return (
    <div className="bs-tip-eq">
      {lines.map(([op, label, value], i) => (
        <div key={label} className={i === lines.length - 1 ? "tot" : undefined}>
          <span className="op">{op}</span>
          <span>{label}</span>
          <span className="v">{unitCost(value)}</span>
        </div>
      ))}
    </div>
  );
}

function LandedTip({ p, mode, airPct }: { p: Price; mode: CostMode; airPct: number }) {
  return (
    <>
      <div className="bs-tip-h">Landed, Quince-paid</div>
      <ModeGrid values={p.quincePaid} mode={mode} />
      <Equation
        lines={[
          ["", "FOB", p.fob ?? 0],
          ["+", `Tariff ${percent(p.tariffRate)}`, p.tariff],
          ["+", `Logistics, ${mode === "blend" ? `${airPct}% air` : mode}`, p.logistics[mode]],
          ["=", `Landed, ${MODE_LABEL[mode].toLowerCase()}`, p.quincePaid[mode]],
        ]}
      />
    </>
  );
}

function DdpTip({ p, mode }: { p: Price; mode: CostMode }) {
  return (
    <>
      <div className="bs-tip-h">DDP, vendor-delivered</div>
      <ModeGrid values={p.ddp ?? { ocean: null, air: null, blend: null }} mode={mode} />
      <div className="bs-tip-note">FOB plus the vendor&rsquo;s highest destination fee. Tariff and freight are in the vendor&rsquo;s price.</div>
    </>
  );
}

function CurrentTip({
  c,
  pcogs,
  rate,
  logistics,
  iso,
  mode,
}: {
  c: Modes;
  pcogs: number;
  rate: number;
  logistics: Modes;
  iso: string | null;
  mode: CostMode;
}) {
  return (
    <>
      <div className="bs-tip-h">Current landed{iso ? ` at ${iso}` : ""}</div>
      <ModeGrid values={c} mode={mode} />
      {pcogs ? (
        <Equation
          lines={[
            ["", "Baseline PCOGS", pcogs],
            ["+", `Tariff ${percent(rate)}`, pcogs * rate],
            ["+", `Logistics, ${mode}`, logistics[mode]],
            ["=", `Current, ${MODE_LABEL[mode].toLowerCase()}`, c[mode]],
          ]}
        />
      ) : (
        <div className="bs-tip-note">Imported estimate. There is no Baseline PCOGS to build it from.</div>
      )}
    </>
  );
}

/** ◆ = the variant's lowest blended cost · * = Quince overrode the basis. */
function BasisMark({ lowest, overridden }: { lowest: boolean; overridden: boolean }) {
  if (!lowest && !overridden) return null;
  return (
    <span className="bs-mark" title={[lowest ? "Lowest on this variant" : "", overridden ? "Quince overrode the automatic freight basis" : ""].filter(Boolean).join(" · ")}>
      {lowest ? "◆" : ""}
      {overridden ? "*" : ""}
    </span>
  );
}

/**
 * The variant's air / ocean split — U3. A ✎ on the header opens a small
 * editor; every vendor beneath recomputes on save. Per VARIANT, so all of a
 * size's bids stay on one freight assumption (P5).
 */
function SplitEditor({ group, onSaved }: { group: BidGroup; onSaved: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [air, setAir] = React.useState(String(group.split.airPct));
  const [busy, setBusy] = React.useState(false);
  const wrap = React.useRef<HTMLSpanElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function save(airPct: number | null) {
    setBusy(true);
    try {
      const r = await fetch(`/api/styles/${group.styleId}/freight-split`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ variationId: group.variationId, airPct }),
      });
      if (r.ok) {
        setOpen(false);
        onSaved();
      }
    } finally {
      setBusy(false);
    }
  }

  const value = Number(air);
  const valid = air.trim() !== "" && Number.isFinite(value) && value >= 0 && value <= 100;

  return (
    <span className="bs-split" ref={wrap}>
      <button
        type="button"
        className={group.split.set ? "bs-split-btn" : "bs-split-btn is-default"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title={group.split.set ? "Air / ocean split for every vendor on this variant" : "Wave default split — click to set one for this variant"}
      >
        Air {group.split.airPct} / Ocean {100 - group.split.airPct}
        <Icon name="edit" size="sm" />
      </button>
      {open ? (
        <span className="bs-split-pop" role="dialog" aria-label="Air and ocean split">
          <label className="bs-split-l" htmlFor={`split-${group.key}`}>
            Air %, applied to every vendor on this variant
          </label>
          <span className="bs-split-row">
            <span className="control sm">
              <input
                id={`split-${group.key}`}
                type="number"
                min={0}
                max={100}
                value={air}
                onChange={(e) => setAir(e.target.value)}
              />
            </span>
            <span className="bs-split-ocean">Ocean {valid ? 100 - value : "—"}%</span>
          </span>
          <span className="bs-split-acts">
            {group.split.set ? (
              <button className="btn btn--ghost sm" disabled={busy} onClick={() => save(null)}>
                Reset to 70 / 30
              </button>
            ) : null}
            {/* Cancel + a primary Apply (Aravind, C30). */}
            <button className="btn btn--secondary sm" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="btn btn--primary sm" disabled={busy || !valid} onClick={() => save(value)}>
              Apply
            </button>
          </span>
        </span>
      ) : null}
    </span>
  );
}
