"use client";

import * as React from "react";
import { Badge, Icon } from "@/ds/components";
import { FilterBar } from "@/components/FilterBar";
import { SortTh, sortRows, type SortState } from "@/components/SortTh";
import { SummaryStrip } from "@/components/SummaryStrip";
import { SideDrawer } from "@/components/SideDrawer";
import { useApi } from "@/lib/useApi";
import { money, unitCost } from "@/lib/format";
import { REGION_ORDER } from "@/components/charts";

/**
 * The vendor master — procurement's view of who Quince works with.
 *
 * Planned as part of S3 and skipped when nomination was redesigned into the
 * one-list-inside-the-RFP pattern. Nomination is done; what was missing is the
 * standalone place to answer "who are we placing business with, and where".
 *
 * Not to be confused with /vendor (singular), which is the vendor-FACING
 * portal. This screen is internal and shows every vendor's name side by side —
 * the exact thing Vendor View must never expose.
 *
 * TYPE IS DERIVED, never stored (Build Doc 3.7): one boolean plus the
 * current-supplier relation gives all three labels, which is why the Wave 1
 * data errors — one vendor carrying three conflicting types — cannot occur.
 */

type Vendor = {
  id: string;
  vendorCode: string;
  name: string;
  countryIso: string | null;
  cooRegion: string | null;
  isNewToQuince: boolean;
  isTemp: boolean;
  type: "INCUMBENT" | "EXISTING" | "NEW";
  stylesSupplied: number;
  quoteCount: number;
  awardCount: number;
  awardedDollars: number;
  savingsDollars: number;
};

type SuppliedStyle = {
  id: string;
  styleNumber: string;
  name: string;
  heroImage: string | null;
  currentFob: number | null;
};

const TYPE_LABEL: Record<Vendor["type"], string> = {
  INCUMBENT: "Incumbent",
  EXISTING: "Existing",
  NEW: "New",
};

export default function VendorsPage() {
  const { data, loading, error } = useApi<Vendor[]>("/api/vendors");
  const [query, setQuery] = React.useState("");
  const [region, setRegion] = React.useState("");
  const [type, setType] = React.useState("");
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [sort, setSort] = React.useState<SortState<"name" | "supplies" | "bids" | "awarded">>(null);

  const rows = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (data ?? []).filter((v) => {
      if (region && v.cooRegion !== region) return false;
      if (type && v.type !== type) return false;
      if (
        q &&
        !v.name.toLowerCase().includes(q) &&
        !v.vendorCode.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
    return sortRows(list, sort, (v, key) =>
      key === "name"
        ? v.name.toLowerCase()
        : key === "supplies"
          ? v.stylesSupplied
          : key === "bids"
            ? v.quoteCount
            : v.awardedDollars,
    );
  }, [data, query, region, type, sort]);

  const open = rows.find((v) => v.id === openId) ?? null;

  // Region counts for the filter, so the shape of the base is visible without
  // having to filter to find out.
  const byRegion = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const v of data ?? []) {
      if (v.cooRegion) m.set(v.cooRegion, (m.get(v.cooRegion) ?? 0) + 1);
    }
    return m;
  }, [data]);

  const placed = rows.reduce((s, v) => s + v.awardedDollars, 0);

  return (
    <>
      <div className="page-hd">
        <div className="row">
          <div className="grow">
            <h1 className="ttl">Vendors</h1>
          </div>
        </div>
      </div>

      {/* Flat, equal cards across the width (Aravind, C3 pattern). */}
      <SummaryStrip
        items={[
          { label: "Vendors", value: data?.length ?? 0 },
          { label: "Placed with them", value: money(placed) },
        ]}
      />

      {error ? (
        <div className="bar bar--danger">
          <Icon name="alert_triangle" />
          <div>
            <strong>Vendors could not be loaded.</strong> {error}
          </div>
        </div>
      ) : null}

      {/* Filter & sort pattern (Aravind, C19): search, Region facet,
          vendor type behind More filters. */}
      <FilterBar
          sticky
        search={{ value: query, onChange: setQuery, placeholder: "Search vendors" }}
        facet={{
          label: "region",
          placeholder: "Select region",
          value: region,
          onChange: setRegion,
          options: REGION_ORDER.filter((r) => byRegion.has(r)).map((r) => ({
            value: r,
            count: byRegion.get(r) ?? 0,
          })),
        }}
        groups={[
          {
            key: "type",
            label: "Vendor type",
            single: true,
            options: (["INCUMBENT", "EXISTING", "NEW"] as const).map((t) => ({
              value: t,
              count: (data ?? []).filter((v) => v.type === t).length,
            })),
            selected: type ? [type] : [],
            format: (v) => TYPE_LABEL[v as Vendor["type"]] ?? v,
          },
        ]}
        onGroupsChange={(next) => setType(next.type?.[0] ?? "")}
        meta={`${rows.length} vendor${rows.length === 1 ? "" : "s"}`}
      />

      <div className="data-grid-surface sticky-head">
        <table className="data-grid">
          <colgroup>
            <col style={{ width: "30%" }} />
            <col style={{ width: "14%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "16%" }} />
            <col style={{ width: "16%" }} />
          </colgroup>
          <thead>
            <tr>
              <SortTh sortKey="name" sort={sort} onSort={setSort}>Vendor</SortTh>
              <th>Region</th>
              <th>Type</th>
              <SortTh sortKey="supplies" sort={sort} onSort={setSort} num>Supplies</SortTh>
              <SortTh sortKey="bids" sort={sort} onSort={setSort} num>Bids</SortTh>
              <SortTh sortKey="awarded" sort={sort} onSort={setSort} num>Awarded</SortTh>
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={6}>
                      <div className="sk" style={{ blockSize: 28 }} />
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
                    <div className="ttl">No vendors match</div>
                    <div className="desc">Try a different filter or search.</div>
                  </div>
                </td>
              </tr>
            ) : null}

            {rows.map((v) => (
              <tr
                key={v.id}
                className="vm-row"
                onClick={() => setOpenId(v.id)}
                tabIndex={0}
                role="button"
                aria-label={`Open ${v.name}`}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setOpenId(v.id);
                  }
                }}
              >
                <td>
                  <div className="vm-id">
                    <span className="vm-name">
                      {v.name}
                      {/* No Temp chip — the code itself reads TEMP-XX001. */}
                    </span>
                    <span className="vm-meta">
                      <span className="id">{v.vendorCode}</span>
                      {v.countryIso ? ` · ${v.countryIso}` : ""}
                    </span>
                  </div>
                </td>
                <td>
                  {v.cooRegion ? (
                    // Plain text: the colour dot was not a status and did not
                    // need a system of its own (Aravind, C20).
                    <span className="vm-region">{v.cooRegion}</span>
                  ) : (
                    <span className="aw-muted">—</span>
                  )}
                </td>
                <td>
                  {/* Neutral badge, the same everywhere (decision D12): type is
                      a qualifier, so it never takes a status tone. */}
                  <Badge>{TYPE_LABEL[v.type]}</Badge>
                </td>
                <td className="num">
                  {v.stylesSupplied || <span className="aw-muted">—</span>}
                </td>
                <td className="num">
                  {v.quoteCount || <span className="aw-muted">—</span>}
                </td>
                <td className="num">
                  {v.awardedDollars ? (
                    money(v.awardedDollars)
                  ) : (
                    <span className="aw-muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <VendorDrawer vendor={open} onClose={() => setOpenId(null)} />
    </>
  );
}

function VendorDrawer({
  vendor,
  onClose,
}: {
  vendor: Vendor | null;
  onClose: () => void;
}) {
  // Keyed by vendor, so switching vendors never shows the previous one's
  // products while the new request is in flight.
  return (
    <VendorDrawerInner
      key={vendor?.id ?? "none"}
      vendor={vendor}
      onClose={onClose}
    />
  );
}

function VendorDrawerInner({
  vendor,
  onClose,
}: {
  vendor: Vendor | null;
  onClose: () => void;
}) {
  const { data, loading } = useApi<SuppliedStyle[]>(
    vendor ? `/api/vendors/${vendor.id}/styles` : null,
  );

  return (
    <SideDrawer
      open={vendor !== null}
      onClose={onClose}
      title={vendor?.name ?? "Vendor"}
      sub={
        vendor
          ? `${vendor.vendorCode}${vendor.countryIso ? ` · ${vendor.countryIso}` : ""}`
          : undefined
      }
    >
      {vendor ? (
        <>
          <div className="pg-baseline">
            <div className="pg-baseline-item">
              <span className="k">Type</span>
              <span className="v">{TYPE_LABEL[vendor.type]}</span>
            </div>
            <div className="pg-baseline-item">
              <span className="k">Region</span>
              <span className="v">{vendor.cooRegion ?? "—"}</span>
            </div>
            <div className="pg-baseline-item">
              <span className="k">Awarded</span>
              <span className="v">{money(vendor.awardedDollars)}</span>
            </div>
          </div>

          <div className="section">
            <div className="hd">In this wave</div>
            <dl className="fact-list">
              <dt>Bids submitted</dt>
              <dd>{vendor.quoteCount}</dd>
              <dt>Products awarded</dt>
              <dd>{vendor.awardCount}</dd>
              <dt>Savings delivered</dt>
              <dd>
                {vendor.savingsDollars ? money(vendor.savingsDollars) : "—"}
              </dd>
            </dl>
          </div>

          <div className="section">
            <div className="hd">
              Currently supplies{" "}
              {vendor.stylesSupplied ? `(${vendor.stylesSupplied})` : ""}
            </div>

            {loading ? <div className="sk" style={{ blockSize: 120 }} /> : null}

            {!loading && (data?.length ?? 0) === 0 ? (
              <div className="empty compact">
                <span className="glyph">
                  <Icon name="sku" size="lg" />
                </span>
                <div className="ttl">Supplies nothing today</div>
                <div className="desc">
                  {vendor.type === "NEW"
                    ? "New to Quince — no current production."
                    : "A challenger on this wave rather than an incumbent."}
                </div>
              </div>
            ) : null}

            <div className="vm-styles">
              {(data ?? []).map((s) => (
                <div className="vm-style" key={s.id}>
                  {s.heroImage ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      className="aw-thumb"
                      src={s.heroImage}
                      alt=""
                      loading="lazy"
                    />
                  ) : (
                    <span className="aw-thumb aw-thumb--empty" />
                  )}
                  <span className="vm-style-text">
                    <span className="id">{s.styleNumber}</span>
                    <span className="vm-style-name">{s.name}</span>
                  </span>
                  <span className="vm-style-fob">{unitCost(s.currentFob)}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </SideDrawer>
  );
}
