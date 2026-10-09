"use client";

import * as React from "react";
import { Badge } from "@/ds/components";
import { SideDrawer } from "@/components/SideDrawer";
import { useApi } from "@/lib/useApi";
import { VariationSwitcher } from "@/components/VariationSwitcher";
import { ProductGallery } from "@/components/ProductGallery";
import { label, money, percent, unitCost, units } from "@/lib/format";

type StyleDetailData = {
  id: string;
  styleNumber: string;
  name: string;
  division: string;
  department: string;
  subDepartment: string;
  subClass: string | null;
  material: string | null;
  variationLevel: string;
  websiteUrl: string | null;
  planUnits: number | null;
  baselineFob: number | null;
  retailPrice: number | null;
  htsCode: string | null;
  sizes: string[];
  colourways: { id: string; name: string; images: string[] }[];
  images: string[];
  heroImage: string | null;
  currentSuppliers: {
    vendorId: string;
    name: string;
    countryIso: string | null;
    cooRegion: string | null;
    currentFob: number | null;
    type: string;
  }[];
  baseline: { buckets: Record<string, number>; fob: number };
  cleanSheet: { buckets: Record<string, number>; fob: number };
  /** Per-variation cost, one entry per bid group at the product's grain. */
  variationCost?: {
    id: string;
    label: string;
    variationIds: string[];
    skuCount: number;
    planUnits: number;
    baselineFob: number | null;
    baseline: Record<string, number>;
    cleanSheet: Record<string, number>;
    suppliers: Record<string, number | null>;
  }[];
  readiness: { hasBaseline: boolean; hasCleanSheet: boolean; hasImages: boolean };
};

export function StyleDetail({
  styleId,
  onClose,
  onPrev,
  onNext,
}: {
  styleId: string | null;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  const { data, loading, error } = useApi<StyleDetailData>(
    styleId ? `/api/styles/${styleId}` : null,
  );

  // Which variation the panels are showing. NULL means "default", resolved
  // to the first group below — there is deliberately no "choose one first"
  // gate, and keying the drawer on styleId already discards this when the
  // style changes, so no reset effect is needed.
  const [variationId, setVariationId] = React.useState<string | null>(null);

  const groups = data?.variationCost ?? [];
  const current =
    groups.find((g) => g.id === variationId) ?? groups[0] ?? null;

  // At STYLE grain there is nothing to switch, so every panel reads the
  // style-level figures exactly as before.
  const showingVariation = groups.length > 1 && current !== null;

  // What the panels actually render. One place decides, so a panel cannot
  // drift out of step with the dropdown.
  const buckets = showingVariation
    ? { baseline: current.baseline, cleanSheet: current.cleanSheet }
    : { baseline: data?.baseline.buckets ?? {}, cleanSheet: data?.cleanSheet.buckets ?? {} };
  const shownFob = showingVariation
    ? (current.baselineFob ?? data?.baselineFob ?? null)
    : (data?.baselineFob ?? null);
  const shownUnits = showingVariation ? current.planUnits : (data?.planUnits ?? null);

  // Totals are SUMMED from the rows above rather than read from a separate
  // field, so the Total FOB line can never disagree with the buckets it
  // sits under.
  const sum = (set: Record<string, number>) =>
    Object.values(set).reduce((total, amount) => total + amount, 0);
  const shownBaselineTotal = showingVariation
    ? sum(buckets.baseline)
    : (data?.baselineFob ?? 0);
  const shownCleanTotal = showingVariation
    ? sum(buckets.cleanSheet)
    : (data?.cleanSheet.fob ?? 0);


  return (
    <SideDrawer
      open={styleId !== null}
      onClose={onClose}
      onPrev={onPrev}
      onNext={onNext}
      title={data?.name ?? (loading ? "Loading…" : "Style")}
      sub={
        data
          ? `${data.styleNumber} · ${data.subDepartment}${data.subClass ? ` · ${data.subClass}` : ""}`
          : undefined
      }
    >
      {error ? (
        <div className="bar bar--danger">
          <div>
            <strong>That style could not be loaded.</strong> {error}
          </div>
        </div>
      ) : null}

      {loading ? <GallerySkeleton /> : null}

      {data ? (
        <>
          {/* One gallery implementation, shared with the vendor quote form
              and the Playground — see components/ProductGallery. */}
          {/* Keyed on the style: a new style must reset the gallery, or the
              second one opens on the first's fourth photo. React discarding the
              state is cheaper and safer than an effect that resets it. */}
          {groups.length > 1 ? (
            <div className="sd-switch">
              <VariationSwitcher
                variations={groups.map((g) => ({ id: g.id, label: g.label }))}
                value={current?.id ?? null}
                onChange={setVariationId}
                axisLabel={axisLabel(data.variationLevel)}
              />
              <span className="sd-switch-note">
                Every figure below is for this {axisLabel(data.variationLevel)?.toLowerCase() ?? "variation"}.
              </span>
            </div>
          ) : null}

          <ProductGallery
            key={styleId}
            images={data.images}
            colourways={data.colourways}
            alt={data.name}
          />

          <div className="section">
            <div className="hd">Details</div>
            <dl className="fact-list">
              <Row k="Division" v={`${data.division} · ${data.department}`} />
              <Row k="Material" v={data.material ?? "—"} />
              <Row k="Quoted at" v={label(data.variationLevel)} />
              {data.sizes.length ? (
                <Row k="Sizes" v={data.sizes.join(" · ")} />
              ) : null}
              <Row k="Plan units" v={`${units(shownUnits)} / yr`} />
              {showingVariation ? (
                <Row k="Baseline FOB" v={unitCost(shownFob)} />
              ) : null}
              <Row k="Retail" v={unitCost(data.retailPrice)} />
              <Row k="HTS code" v={data.htsCode ?? "—"} />
            </dl>
          </div>

          <div className="section">
            <div className="hd">Current suppliers</div>
            {data.currentSuppliers.length ? (
              <div className="data-grid-surface">
              <table className="data-grid">
                <thead>
                  <tr>
                    <th>Vendor</th>
                    <th>Type</th>
                    <th>COO</th>
                    <th className="num">Current FOB</th>
                  </tr>
                </thead>
                <tbody>
                  {data.currentSuppliers.map((s) => (
                    <tr key={s.vendorId}>
                      <td>{s.name}</td>
                      <td>
                        <Badge tone={s.type === "NEW" ? "info" : undefined}>
                          {label(s.type)}
                        </Badge>
                      </td>
                      <td>{s.countryIso ?? "—"}</td>
                      <td className="num">
                        {unitCost(
                          showingVariation
                            ? (current.suppliers[s.vendorId] ?? s.currentFob)
                            : s.currentFob,
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            ) : (
              <p style={{ color: "var(--color-neutral-foreground-muted-enabled)" }}>
                No current supplier recorded for this style.
              </p>
            )}
          </div>

          <div className="section">
            <div className="hd">Cost breakdown</div>
            <div className="data-grid-surface">
            <table className="data-grid">
              <thead>
                <tr>
                  <th>Bucket</th>
                  <th className="num">Baseline</th>
                  <th className="num">Clean sheet</th>
                  <th className="num">Gap</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(buckets.cleanSheet).map(([bucket, clean]) => {
                  // The REAL baseline for this bucket. Scaling the clean sheet
                  // to recover it forced every row to the same gap and hid the
                  // per-bucket should-cost targets entirely.
                  const baseline = buckets.baseline[bucket] ?? 0;
                  return (
                    <tr key={bucket}>
                      <td>{label(bucket)}</td>
                      <td className="num">{unitCost(baseline)}</td>
                      <td className="num">{unitCost(clean)}</td>
                      <td className="num">
                        {percent(baseline ? (baseline - clean) / baseline : 0)}
                      </td>
                    </tr>
                  );
                })}
                <tr>
                  <td>
                    <strong>Total FOB</strong>
                  </td>
                  <td className="num">
                    <strong>{unitCost(shownBaselineTotal)}</strong>
                  </td>
                  <td className="num">
                    <strong>{unitCost(shownCleanTotal)}</strong>
                  </td>
                  <td className="num">
                    <strong>
                      {percent(
                        shownBaselineTotal
                          ? (shownBaselineTotal - shownCleanTotal) /
                              shownBaselineTotal
                          : 0,
                      )}
                    </strong>
                  </td>
                </tr>
              </tbody>
            </table>
            </div>
            {/* The clean sheet is internal only and must never reach a vendor
                surface — said plainly on screen so nobody screen-shares it by
                accident. */}
            <p
              style={{
                color: "var(--color-neutral-foreground-muted-enabled)",
                fontSize: "var(--type-caption-size)",
                marginBlockStart: "var(--space-sm)",
              }}
            >
              Clean sheet is internal only. It is never shown to vendors.
            </p>
          </div>

          <div className="section">
            <div className="hd">Readiness</div>
            <dl className="fact-list">
              <Row
                k="Baseline"
                v={
                  <Badge tone={data.readiness.hasBaseline ? "success" : "danger"}>
                    {data.readiness.hasBaseline ? "Present" : "Missing"}
                  </Badge>
                }
              />
              <Row
                k="Clean sheet"
                v={
                  <Badge tone={data.readiness.hasCleanSheet ? "success" : "warning"}>
                    {data.readiness.hasCleanSheet ? "Present" : "Missing"}
                  </Badge>
                }
              />
              <Row
                k="Annual spend"
                v={money((data.planUnits ?? 0) * (data.baselineFob ?? 0))}
              />
            </dl>
          </div>
        </>
      ) : null}
    </SideDrawer>
  );
}

/**
 * One fact in a .fact-list.
 *
 * The dt and dd are returned as SIBLINGS, with no wrapper: .fact-list is a
 * two-column grid, so a wrapping <div> would be the grid item and each pair
 * would stack inside its own single cell — which is exactly what .meta-list
 * does on purpose, and what this layout exists to avoid.
 */
function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </>
  );
}

function GallerySkeleton() {
  return (
    <div className="detail-gallery">
      <div className="detail-hero sk" />
      <div className="detail-thumbs">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="sk" style={{ inlineSize: 56, blockSize: 56 }} />
        ))}
      </div>
    </div>
  );
}

/** Names the axis the dropdown switches along, so it explains itself. */
function axisLabel(variationLevel: string): string | undefined {
  if (variationLevel === "SIZE") return "Size";
  if (variationLevel === "COLOUR") return "Colour";
  if (variationLevel === "SKU") return "Colour × size";
  return undefined;
}
