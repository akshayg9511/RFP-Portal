"use client";

import * as React from "react";
import { Icon } from "@/ds/components";
import { SideDrawer } from "@/components/SideDrawer";
import { useApi } from "@/lib/useApi";
import { money, unitCost } from "@/lib/format";
import { regionColor, REGION_ORDER } from "@/components/charts";

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

  const rows = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data ?? []).filter((v) => {
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
  }, [data, query, region, type]);

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
        <h1>Vendors</h1>
        <div className="acts">
          <span className="aw-summary">
            <span className="k">Vendors</span>
            <span className="v">{data?.length ?? 0}</span>
          </span>
          <span className="aw-summary">
            <span className="k">Placed with them</span>
            <span className="v">{money(placed)}</span>
          </span>
        </div>
      </div>

      {error ? (
        <div className="bar bar--danger">
          <Icon name="alert_triangle" />
          <div>
            <strong>Vendors could not be loaded.</strong> {error}
          </div>
        </div>
      ) : null}

      <div className="aw-filters">
        <div className="control search sm aw-search">
          <Icon name="search" size="sm" />
          <input
            placeholder="Search vendors"
            aria-label="Search vendors"
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
          {REGION_ORDER.filter((r) => byRegion.has(r)).map((r) => (
            <option key={r} value={r}>
              {r} ({byRegion.get(r)})
            </option>
          ))}
        </select>

        <select
          className="control sm"
          aria-label="Filter by vendor type"
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          <option value="">All types</option>
          <option value="INCUMBENT">Incumbent</option>
          <option value="EXISTING">Existing</option>
          <option value="NEW">New to Quince</option>
        </select>

        <span className="aw-filter-count">
          {rows.length} of {data?.length ?? 0} vendors
        </span>
      </div>

      <div className="data-grid-surface">
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
              <th>Vendor</th>
              <th>Region</th>
              <th>Type</th>
              <th className="num">Supplies</th>
              <th className="num">Bids</th>
              <th className="num">Awarded</th>
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
                    <span className="vm-region">
                      {/* The same entity colours as every chart, so a region
                          means the same thing on every screen. */}
                      <span
                        className="chart-swatch"
                        style={{ background: regionColor(v.cooRegion) }}
                        aria-hidden="true"
                      />
                      {v.cooRegion}
                    </span>
                  ) : (
                    <span className="aw-muted">—</span>
                  )}
                </td>
                <td>
                  {/* Neutral. Type is a QUALIFIER, not a status — giving it a
                      tone made it read as a state beside the real ones. */}
                  <span className="vl-type">{TYPE_LABEL[v.type]}</span>
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
