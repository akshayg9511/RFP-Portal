"use client";

import * as React from "react";
import { Icon } from "@/ds/components";
import { useApi } from "@/lib/useApi";
import { useSelection } from "@/lib/selection";
import { money, units } from "@/lib/format";
import { SaveAsSetDialog } from "./SaveAsSetDialog";
import { SelectionTray } from "../style-sets/SelectionTray";
import { ReviewVariationsModal } from "../style-sets/ReviewVariationsModal";
import { FilterBar } from "@/components/FilterBar";
import { SortTh, sortRows, type SortState } from "@/components/SortTh";
import { SummaryStrip } from "@/components/SummaryStrip";
import { Badge, Checkbox } from "@/ds/components";
import { GRAINS, isExpandable, type Grain } from "@/domain/grain";
import {
  useVariationGroups,
  VariationRows,
} from "@/components/VariationRows";

/**
 * The Product catalog — the funnel's mouth.
 *
 * Style sets could not be created: `api/style-sets` was GET-only, so §3.1's
 * "manual, reusable" grouping was neither. And selection was scoped to ONE set
 * at a time, so building a 23-product set drawn from four sets meant entering
 * and leaving each one.
 *
 * This is deliberately NOT merged into Award Summary. The catalogue is a funnel
 * — at 10,000 products you sort by revenue and attribute down to the few
 * hundred a wave touches — whereas Award Summary exists to award what was
 * already sent out. Same data, different job.
 *
 * Revenue leads because that is how a catalogue is triaged for sourcing: the
 * biggest sellers are where a percentage point is worth most.
 */

type Row = {
  id: string;
  styleNumber: string;
  name: string;
  division: string;
  department: string;
  subDepartment: string | null;
  material: string | null;
  heroImage: string | null;
  planUnits: number | null;
  baselineFob: number | null;
  retailPrice: number | null;
  revenue: number;
  annualSpend: number;
  skuCount: number;
  variationLevel: Grain;
  colourwayCount: number;
  bidCount: number;
  setCount: number;
};

type Facet = { value: string; count: number };

/** Same wording as Variation setup — one vocabulary for one concept. */
const GRAIN_LABEL: Record<Grain, string> = {
  STYLE: "Style",
  COLOUR: "Colour",
  SIZE: "Size",
  SKU: "Colour × size",
};

type Catalog = {
  facets: {
    division: Facet[];
    department: Facet[];
    subDepartment: Facet[];
    material: Facet[];
  };
  total: number;
  styles: Row[];
};

type SortKey = "revenue" | "spend" | "units" | "styleNumber";

const REVENUE_BANDS = [
  { label: "Any revenue", value: 0 },
  { label: "Over $1M", value: 1_000_000 },
  { label: "Over $5M", value: 5_000_000 },
  { label: "Over $10M", value: 10_000_000 },
  { label: "Over $20M", value: 20_000_000 },
];

export default function ProductCatalogPage() {
  const [query, setQuery] = React.useState("");
  const [division, setDivision] = React.useState("");
  const [department, setDepartment] = React.useState("");
  const [subDepartment, setSubDepartment] = React.useState("");
  const [material, setMaterial] = React.useState("");
  const [minRevenue, setMinRevenue] = React.useState(0);
  const [inSet, setInSet] = React.useState("");
  // Sort lives in the column headers now (Aravind, C4). Revenue first, as before.
  const [sort, setSort] = React.useState<SortState<SortKey>>({ key: "revenue", dir: "desc" });
  // ONE row open at a time. The catalog has no pagination, so several open
  // SKU-grain products would push a very long page; and it matches how the
  // RFP Products tab already behaves.
  const [openRow, setOpenRow] = React.useState<string | null>(null);
  const [grain, setGrain] = React.useState("");
  const [saveOpen, setSaveOpen] = React.useState(false);

  // Filters go to the SERVER: at catalogue scale the client cannot hold every
  // product, and the facet counts have to come from the same filtered set the
  // rows do or the two disagree.
  const params = new URLSearchParams();
  if (query.trim()) params.set("q", query.trim());
  if (division) params.set("division", division);
  if (department) params.set("department", department);
  if (subDepartment) params.set("subDepartment", subDepartment);
  if (material) params.set("material", material);
  if (minRevenue) params.set("minRevenue", String(minRevenue));
  if (inSet) params.set("inSet", inSet);

  const { data, loading, error } = useApi<Catalog>(
    `/api/styles?${params.toString()}`,
  );
  const selection = useSelection();
  const [reviewOpen, setReviewOpen] = React.useState(false);

  const rows = React.useMemo(() => {
    // Grain is filtered client-side. The catalog API has no grain param, and
    // adding one would change a response shape /style-sets/[id] also reads.
    const list = (data?.styles ?? []).filter(
      (r) => !grain || r.variationLevel === grain,
    );
    return sortRows(list, sort, (r, key) =>
      key === "styleNumber"
        ? r.styleNumber
        : key === "units"
          ? r.planUnits ?? 0
          : key === "spend"
            ? r.annualSpend
            : r.revenue,
    );
  }, [data, sort, grain]);

  const filtered =
    Boolean(
      query.trim() ||
        division ||
        department ||
        subDepartment ||
        material ||
        minRevenue ||
        inSet ||
        grain,
    );

  function clearFilters() {
    setQuery("");
    setDivision("");
    setDepartment("");
    setSubDepartment("");
    setMaterial("");
    setMinRevenue(0);
    setInSet("");
    setGrain("");
  }

  const allVisibleSelected =
    rows.length > 0 && rows.every((r) => selection.isSelected(r.id));

  return (
    <>
      <div className="page-hd">
        <div className="row">
          <div className="grow">
            <h1 className="ttl">Product catalog</h1>
          </div>
        </div>
      </div>

      {/* Flat, equal cards across the width (Aravind, C3). */}
      <SummaryStrip
        items={[
          { label: "Products", value: units(data?.total ?? 0) },
          { label: "Revenue shown", value: money(rows.reduce((t, r) => t + r.revenue, 0)) },
        ]}
      />

      {error ? (
        <div className="bar bar--danger">
          <Icon name="alert_triangle" />
          <div>
            <strong>The catalog could not be loaded.</strong> {error}
          </div>
        </div>
      ) : null}

      {/* Filter & sort pattern (Aravind, C4): search, ONE facet
          (department), and everything else in the More filters panel. */}
      <FilterBar
        search={{ value: query, onChange: setQuery, placeholder: "Search style number or name" }}
        facet={{
          label: "department",
          placeholder: "Select department",
          value: department,
          onChange: setDepartment,
          options: data?.facets.department ?? [],
        }}
        groups={[
          { key: "division", label: "Division", single: true, options: data?.facets.division ?? [], selected: division ? [division] : [] },
          { key: "subDepartment", label: "Sub-department", single: true, options: data?.facets.subDepartment ?? [], selected: subDepartment ? [subDepartment] : [] },
          { key: "material", label: "Material", single: true, options: data?.facets.material ?? [], selected: material ? [material] : [] },
          {
            key: "revenue",
            label: "Revenue",
            single: true,
            options: REVENUE_BANDS.filter((b) => b.value > 0).map((b) => ({ value: String(b.value), count: -1 })),
            selected: minRevenue ? [String(minRevenue)] : [],
            format: (v) => REVENUE_BANDS.find((b) => String(b.value) === v)?.label ?? v,
          },
          {
            key: "inSet",
            label: "Style set",
            single: true,
            options: [{ value: "any", count: -1 }, { value: "none", count: -1 }],
            selected: inSet ? [inSet] : [],
            format: (v) => (v === "any" ? "In a style set" : "Not in any set"),
          },
          {
            key: "grain",
            label: "Bid grain",
            single: true,
            options: GRAINS.map((g) => ({ value: g, count: -1 })),
            selected: grain ? [grain] : [],
            format: (v) => `${GRAIN_LABEL[v as Grain]} level`,
          },
        ]}
        onGroupsChange={(next) => {
          setDivision(next.division?.[0] ?? "");
          setSubDepartment(next.subDepartment?.[0] ?? "");
          setMaterial(next.material?.[0] ?? "");
          setMinRevenue(Number(next.revenue?.[0] ?? 0));
          setInSet(next.inSet?.[0] ?? "");
          setGrain(next.grain?.[0] ?? "");
        }}
        meta={`${rows.length} product${rows.length === 1 ? "" : "s"}${selection.count ? ` · ${selection.count} selected` : ""}`}
      />

      <div className="data-grid-surface">
        <table className="data-grid aw-grid">
          {/* Grain sits after Category and BEFORE the numeric run, so the
              right-aligned figures stay contiguous — splitting them is the
              A13 defect that made the RFP list read as skewed. */}
          <colgroup>
            <col style={{ width: "4%" }} />
            <col style={{ width: "27%" }} />
            <col style={{ width: "14%" }} />
            <col style={{ width: "11%" }} />
            <col style={{ width: "11%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "9%" }} />
          </colgroup>
          <thead>
            <tr>
              <th>
                {/* Selects only what is VISIBLE — with a filter applied that is
                    the point, and with 10,000 products selecting all of them
                    would never be meant. */}
                <Checkbox
                  aria-label="Select all shown products"
                  checked={allVisibleSelected}
                  mixed={selection.count > 0 && !allVisibleSelected}
                  onChange={() => {
                    if (allVisibleSelected) {
                      for (const r of rows) {
                        if (selection.isSelected(r.id)) selection.toggle(toSelected(r));
                      }
                    } else {
                      selection.addMany(rows.map(toSelected));
                    }
                  }}
                />
              </th>
              <SortTh sortKey="styleNumber" sort={sort} onSort={setSort}>Product</SortTh>
              <th>Category</th>
              <th>Bid grain</th>
              <SortTh sortKey="units" sort={sort} onSort={setSort} num>Plan units</SortTh>
              <SortTh sortKey="revenue" sort={sort} onSort={setSort} num>Revenue</SortTh>
              <SortTh sortKey="spend" sort={sort} onSort={setSort} num>Annual spend</SortTh>
              <th className="num">Sets · bids</th>
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 10 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={8}>
                      <div className="sk" style={{ blockSize: 30 }} />
                    </td>
                  </tr>
                ))
              : null}

            {!loading && rows.length === 0 ? (
              <tr>
                <td colSpan={8}>
                  <div className="empty compact">
                    <span className="glyph">
                      <Icon name="search" size="lg" />
                    </span>
                    <div className="ttl">No products match</div>
                    <div className="desc">
                      {filtered
                        ? "Try a wider filter, or clear them."
                        : "The catalog is empty."}
                    </div>
                  </div>
                </td>
              </tr>
            ) : null}

            {rows.map((r) => (
              <ProductRow
                key={r.id}
                row={r}
                open={openRow === r.id}
                onOpen={() => setOpenRow(openRow === r.id ? null : r.id)}
              />
            ))}
          </tbody>
        </table>
      </div>

      <SaveAsSetDialog
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        styleIds={[...selection.selected.keys()]}
        styles={[...selection.selected.values()].map((v) => ({
          styleId: v.id,
          variationIds: v.variationIds ?? [],
        }))}
        onSaved={() => {
          setSaveOpen(false);
          selection.clear();
        }}
      />

      {/* The same tray the style-set browser uses — the selection lives above
          the route, so one built here follows into an RFP or into a set. */}
      <ReviewVariationsModal
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
      />

      <SelectionTray
        count={selection.count}
        skuCount={selection.skuCount}
        annualSpend={selection.annualSpend}
        templateCount={selection.templateCount}
        onClear={selection.clear}
        onReviewVariations={() => setReviewOpen(true)}
        onSaveAsSet={() => setSaveOpen(true)}
      />
    </>
  );
}

/**
 * One product row, plus its variation rows when expanded.
 *
 * Split out because the hook that lazy-loads variations cannot be called
 * inside a `.map()` in the parent — hooks need a component boundary.
 */
function ProductRow({
  row: r,
  open,
  onOpen,
}: {
  row: Row;
  open: boolean;
  onOpen: () => void;
}) {
  const selection = useSelection();
  const expandable = isExpandable(r.variationLevel);
  const { groups, loading } = useVariationGroups(r.id, open && expandable);
  const chosen = selection.variationsOf(r.id);
  const partial = selection.isPartial(r.id);

  return (
    <>
              <tr
                className={selection.isSelected(r.id) ? "pc-row is-on" : "pc-row"}
              >
                <td>
                  <Checkbox
                    aria-label={`Select ${r.name}`}
                    checked={selection.isSelected(r.id) && !partial}
                    mixed={partial}
                    onChange={() => {
                      // On a variation-grained product the parent box is a
                      // shortcut for "all of them", so it needs the id list —
                      // which only exists once the row has been expanded.
                      if (expandable && groups) {
                        selection.selectAllVariations(
                          toSelected(r),
                          groups.flatMap((g) => g.variationIds),
                        );
                      } else {
                        selection.toggle(toSelected(r));
                      }
                    }}
                  />
                </td>
                <td>
                  <div className="aw-product">
                    {expandable ? (
                      <button
                        className="pc-chev"
                        onClick={onOpen}
                        aria-expanded={open}
                        aria-label={`${open ? "Hide" : "Show"} variations of ${r.name}`}
                      >
                        <Icon
                          name={open ? "chevron_up" : "chevron_down"}
                          size="sm"
                        />
                      </button>
                    ) : (
                      /* A style-grained product has nothing to expand. An
                         empty slot keeps the names on one left edge. */
                      <span className="pc-chev pc-chev--none" />
                    )}
                    {r.heroImage ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img className="aw-thumb" src={r.heroImage} alt="" loading="lazy" />
                    ) : (
                      <span className="aw-thumb aw-thumb--empty" />
                    )}
                    <span className="aw-product-text">
                      <span className="aw-product-name">
                        <span className="id">{r.styleNumber}</span>
                        <span className="aw-name">{r.name}</span>
                      </span>
                      <span className="aw-product-meta">
                        {r.skuCount} SKUs
                        {r.material ? ` · ${r.material}` : ""}
                        {chosen.length
                          ? ` · ${chosen.length} selected`
                          : ""}
                      </span>
                    </span>
                  </div>
                </td>
                <td>
                  <span className="pc-cat">
                    {r.department}
                    {r.subDepartment ? (
                      <span className="sub">{r.subDepartment}</span>
                    ) : null}
                  </span>
                </td>
                <td>
                  {/* The grain is set on Variation setup; here it is a
                      read-only fact, so it wears a badge rather than a
                      control. `info` only when there is something to
                      expand — a style-grain badge competing for attention
                      with 62 others that DO expand is noise. */}
                  <Badge tone={isExpandable(r.variationLevel) ? "info" : undefined}>
                    {GRAIN_LABEL[r.variationLevel]}
                  </Badge>
                </td>
                <td className="num">{units(r.planUnits)}</td>
                <td className="num">
                  {/* planUnits x retailPrice. Revenue2026 is in the schema and
                      seeded on nothing, so it is derived from two columns that
                      are populated on every style. */}
                  {money(r.revenue)}
                  {r.retailPrice ? (
                    <span className="pc-sub">@ {money(r.retailPrice, 0)}</span>
                  ) : null}
                </td>
                <td className="num">{money(r.annualSpend)}</td>
                <td className="num">
                  <span className={r.setCount ? undefined : "aw-muted"}>
                    {r.setCount}
                  </span>
                  {" · "}
                  <span className={r.bidCount ? undefined : "aw-muted"}>
                    {r.bidCount}
                  </span>
                </td>
              </tr>

      {open && expandable ? (
        <VariationRows
          style={toSelected(r)}
          groups={groups}
          loading={loading}
          selectedIds={chosen}
          onToggle={selection.toggleVariation}
          columns={8}
        />
      ) : null}
    </>
  );
}

function toSelected(r: Row) {
  return {
    id: r.id,
    styleNumber: r.styleNumber,
    name: r.name,
    division: r.division,
    department: r.department,
    annualSpend: r.annualSpend,
  };
}


