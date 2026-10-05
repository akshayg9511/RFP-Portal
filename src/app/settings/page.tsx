"use client";

import * as React from "react";
import { Badge, Checkbox, Icon } from "@/ds/components";
import { useApi } from "@/lib/useApi";
import { FacetSelect } from "@/components/FacetSelect";
import { units } from "@/lib/format";
import {
  allowedForAll,
  GRAINS,
  type Grain,
  isExpandable,
} from "@/domain/grain";

/**
 * VARIATION SETUP — which axis each product is bid on.
 *
 * `Style.variationLevel` is the runtime source of truth for grain (D1). The
 * seed gives every product a starting value so this screen opens populated
 * and editable; after that this screen owns it.
 *
 * The ladder is ONE-WAY (STYLE -> COLOUR/SIZE -> SKU). Illegal targets are
 * ABSENT from the picker rather than disabled: a disabled option invites
 * "why can't I?" and needs explanatory copy on every row.
 */

type Row = {
  id: string;
  styleNumber: string;
  name: string;
  division: string;
  department: string;
  subDepartment: string | null;
  variationLevel: Grain;
  colourwayCount: number;
  skuCount: number;
  planUnits: number | null;
  setCount: number;
  bidCount: number;
};

type Facet = { value: string; count: number };

type Catalog = {
  styles: Row[];
  total: number;
  facets: {
    division: Facet[];
    department: Facet[];
    subDepartment: Facet[];
    material: Facet[];
  };
};

/** How many bid groups this product yields at a given grain. */
function groupCount(row: Row, grain: Grain): number {
  if (grain === "STYLE") return 1;
  if (grain === "COLOUR") return row.colourwayCount;
  if (grain === "SKU") return row.skuCount;
  // Sizes are not counted separately by the API; derive from the SKU spread.
  return row.colourwayCount ? Math.round(row.skuCount / row.colourwayCount) : row.skuCount;
}

const GRAIN_LABEL: Record<Grain, string> = {
  STYLE: "Style",
  COLOUR: "Colour",
  SIZE: "Size",
  SKU: "Colour × size",
};

export default function VariationSetupPage() {
  const [query, setQuery] = React.useState("");
  const [division, setDivision] = React.useState("");
  const [department, setDepartment] = React.useState("");
  const [subDepartment, setSubDepartment] = React.useState("");
  const [grainFilter, setGrainFilter] = React.useState("");
  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<{
    tone: "ok" | "error";
    text: string;
  } | null>(null);

  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (division) params.set("division", division);
  if (department) params.set("department", department);
  if (subDepartment) params.set("subDepartment", subDepartment);

  const { data, loading, error, reload } = useApi<Catalog>(
    `/api/styles?${params}`,
  );

  // Grain is filtered client-side — the catalog API does not know about it,
  // and adding a param there would change a shape two other screens read.
  const rows = React.useMemo(() => {
    const all = data?.styles ?? [];
    return grainFilter
      ? all.filter((r) => r.variationLevel === grainFilter)
      : all;
  }, [data, grainFilter]);

  // A success note is transient; an error waits, because an error that
  // vanishes while you are reading the row it refers to is worse.
  React.useEffect(() => {
    if (note?.tone !== "ok") return;
    const timer = setTimeout(() => setNote(null), 3000);
    return () => clearTimeout(timer);
  }, [note]);

  // Selection survives a filter change, so the bulk rule must be computed
  // over the UNFILTERED set. Using `rows` here was a real bug: picking a
  // COLOUR product, then filtering to SIZE, dropped the COLOUR product out
  // of the calculation and the tray offered Size — an illegal COLOUR->SIZE
  // move that the API then correctly refused. The tray must never offer
  // what the server will reject.
  const pickedRows = React.useMemo(
    () => (data?.styles ?? []).filter((r) => picked.has(r.id)),
    [data, picked],
  );

  // The bulk picker offers only what is legal for EVERY selected product.
  const bulkAllowed = React.useMemo(
    () => allowedForAll(pickedRows.map((r) => r.variationLevel)),
    [pickedRows],
  );

  const allShownPicked =
    rows.length > 0 && rows.every((r) => picked.has(r.id));

  const shownIds = new Set(rows.map((r) => r.id));
  const hiddenPicked = [...picked].filter((id) => !shownIds.has(id)).length;

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllShown() {
    setPicked((prev) => {
      const next = new Set(prev);
      if (allShownPicked) rows.forEach((r) => next.delete(r.id));
      else rows.forEach((r) => next.add(r.id));
      return next;
    });
  }

  async function setGrain(styleIds: string[], grain: Grain) {
    setBusy(true);
    try {
      const response = await fetch("/api/styles/grain", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ styleIds, grain }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.message ?? "Could not save");
      setNote({
        tone: "ok",
        text:
          body.updated === 0
            ? `Already at ${GRAIN_LABEL[grain].toLowerCase()} level.`
            : `${body.updated} product${body.updated === 1 ? "" : "s"} now bid at ${GRAIN_LABEL[grain].toLowerCase()} level.`,
      });
      setPicked(new Set());
      reload();
    } catch (problem) {
      setNote({ tone: "error", text: String((problem as Error).message) });
    } finally {
      setBusy(false);
    }
  }

  const filtered = Boolean(
    query || division || department || subDepartment || grainFilter,
  );

  return (
    <>
      <div className="page-hd">
        <h1>Variation setup</h1>
      </div>

      <div className="card">
        <div className="card-b">
          <p className="vs-lede">
            Which axis each product is bid, compared and awarded on. A grain
            can move <strong>down</strong> the ladder — style to colour or
            size, then to colour × size — but never back up or sideways, because
            a bid already placed against a colour has nowhere to go.
          </p>

          <div className="aw-filters">
            <div className="control search sm aw-search">
              <Icon name="search" size="sm" />
              <input
                placeholder="Search style number or name"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search products"
              />
            </div>

            <FacetSelect
              label="division"
              value={division}
              onChange={setDivision}
              options={data?.facets.division ?? []}
            />
            <FacetSelect
              label="department"
              value={department}
              onChange={setDepartment}
              options={data?.facets.department ?? []}
            />
            <FacetSelect
              label="sub-department"
              value={subDepartment}
              onChange={setSubDepartment}
              options={data?.facets.subDepartment ?? []}
            />

            <select
              className="control sm"
              aria-label="Filter by current grain"
              value={grainFilter}
              onChange={(e) => setGrainFilter(e.target.value)}
            >
              <option value="">All grains</option>
              {GRAINS.map((g) => (
                <option key={g} value={g}>
                  {GRAIN_LABEL[g]} level
                </option>
              ))}
            </select>

            {filtered ? (
              <button
                className="btn btn--ghost sm"
                onClick={() => {
                  setQuery("");
                  setDivision("");
                  setDepartment("");
                  setSubDepartment("");
                  setGrainFilter("");
                }}
              >
                Clear
              </button>
            ) : null}

            <span className="aw-filter-count">
              {rows.length} shown
              {picked.size ? ` · ${picked.size} selected` : ""}
            </span>
          </div>

          {note ? (
            <div className={note.tone === "ok" ? "bar" : "bar bar--danger"}>
              <span>{note.text}</span>
              {note.tone === "error" ? (
                <button
                  className="x"
                  onClick={() => setNote(null)}
                  aria-label="Dismiss"
                >
                  <Icon name="close" size="sm" />
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="data-grid-surface">
            <table className="data-grid aw-grid">
              <colgroup>
                <col style={{ width: "4%" }} />
                <col style={{ width: "32%" }} />
                <col style={{ width: "18%" }} />
                <col style={{ width: "14%" }} />
                <col style={{ width: "12%" }} />
                <col style={{ width: "20%" }} />
              </colgroup>
              <thead>
                <tr>
                  <th>
                    <Checkbox
                      checked={allShownPicked}
                      mixed={picked.size > 0 && !allShownPicked}
                      onChange={toggleAllShown}
                      aria-label="Select all shown products"
                    />
                  </th>
                  <th>Product</th>
                  <th>Category</th>
                  <th>Bid grain</th>
                  <th className="num">Bid groups</th>
                  <th>Change to</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i}>
                      <td colSpan={6}>
                        <div className="sk" style={{ blockSize: 30 }} />
                      </td>
                    </tr>
                  ))
                ) : error ? (
                  <tr>
                    <td colSpan={6}>
                      <div className="empty compact">
                        <div className="ttl">Could not load products</div>
                        <div className="desc">{String(error)}</div>
                      </div>
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={6}>
                      <div className="empty compact">
                        <div className="ttl">No product matches</div>
                        <div className="desc">
                          Widen the filters to see more products.
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => {
                    const allowed = allowedForAll([row.variationLevel]);
                    return (
                      <tr
                        key={row.id}
                        className={picked.has(row.id) ? "pc-row is-on" : "pc-row"}
                      >
                        <td>
                          <Checkbox
                            checked={picked.has(row.id)}
                            onChange={() => toggle(row.id)}
                            aria-label={`Select ${row.name}`}
                          />
                        </td>
                        <td>
                          <span className="aw-product-text">
                            <span className="aw-product-name">
                              <span className="id">{row.styleNumber}</span>
                              <span className="aw-name">{row.name}</span>
                            </span>
                            <span className="aw-product-meta">
                              {row.skuCount} SKUs · {row.colourwayCount}{" "}
                              colourway{row.colourwayCount === 1 ? "" : "s"}
                              {row.bidCount ? ` · ${row.bidCount} bids` : ""}
                            </span>
                          </span>
                        </td>
                        <td>
                          <span className="pc-cat">
                            {row.department}
                            {row.subDepartment ? (
                              <span className="sub">{row.subDepartment}</span>
                            ) : null}
                          </span>
                        </td>
                        <td>
                          <Badge tone={isExpandable(row.variationLevel) ? "info" : undefined}>
                            {GRAIN_LABEL[row.variationLevel]}
                          </Badge>
                        </td>
                        <td className="num">
                          {units(groupCount(row, row.variationLevel))}
                        </td>
                        <td>
                          {allowed.filter((g) => g !== row.variationLevel)
                            .length === 0 ? (
                            <span className="vs-leaf">
                              Most granular — nothing below
                            </span>
                          ) : (
                            <span className="vs-actions">
                              {allowed
                                .filter((g) => g !== row.variationLevel)
                                .map((g) => (
                                  <button
                                    key={g}
                                    className="btn btn--ghost sm"
                                    disabled={busy}
                                    onClick={() => setGrain([row.id], g)}
                                  >
                                    {GRAIN_LABEL[g]}
                                  </button>
                                ))}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {picked.size > 0 ? (
        <div className="sel-bar fixed">
          <span className="cnt">
            {picked.size} product{picked.size === 1 ? "" : "s"} selected
            {/* Selection survives filtering, so say when some of it is
                off-screen — otherwise the offered grains look wrong for
                what the user can actually see. */}
            {hiddenPicked > 0 ? (
              <>
                {" · "}
                <strong>{hiddenPicked} not shown</strong>
              </>
            ) : null}
          </span>
          <div className="acts">
            {bulkAllowed.length === 0 ? (
              <span className="vs-leaf">
                No grain is legal for every selected product
              </span>
            ) : (
              <>
                <span className="vs-bulk-label">Set grain to</span>
                {bulkAllowed.map((g) => (
                  <button
                    key={g}
                    className="btn btn--ghost sm"
                    disabled={busy}
                    onClick={() => setGrain([...picked], g)}
                  >
                    {GRAIN_LABEL[g]}
                  </button>
                ))}
              </>
            )}
            <button
              className="btn btn--ghost"
              onClick={() => setPicked(new Set())}
            >
              Clear
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
