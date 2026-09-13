"use client";

import * as React from "react";
import { Badge } from "@/ds/components";
import { SideDrawer } from "@/components/SideDrawer";
import { useApi } from "@/lib/useApi";
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
  cleanSheet: { buckets: Record<string, number>; fob: number };
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

  const [colourway, setColourway] = React.useState(0);
  const [image, setImage] = React.useState(0);

  // A new style resets the gallery, or the second style opens on the first
  // style's fourth photo.
  React.useEffect(() => {
    setColourway(0);
    setImage(0);
  }, [styleId]);

  const gallery =
    data?.colourways[colourway]?.images.length
      ? data.colourways[colourway].images
      : (data?.images ?? []);

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
          <div className="detail-gallery">
            <div className="detail-hero">
              {gallery[image] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={gallery[image]} alt={data.name} />
              ) : (
                <div className="thumb blank" />
              )}
            </div>

            {gallery.length > 1 ? (
              <div className="detail-thumbs">
                {gallery.map((url, i) => (
                  <button
                    key={`${i}-${url}`}
                    className={i === image ? "on" : undefined}
                    onClick={() => setImage(i)}
                    aria-label={`Image ${i + 1} of ${gallery.length}`}
                    aria-pressed={i === image}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt="" loading="lazy" />
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {data.colourways.length > 1 ? (
            <div className="section">
              <div className="hd">Colourways</div>
              <div style={{ display: "flex", gap: "var(--space-xs)", flexWrap: "wrap" }}>
                {data.colourways.map((c, i) => (
                  <button
                    key={c.id}
                    className={i === colourway ? "chip on" : "chip"}
                    aria-pressed={i === colourway}
                    onClick={() => {
                      setColourway(i);
                      setImage(0);
                    }}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="section">
            <div className="hd">Details</div>
            <dl className="meta-list">
              <Row k="Division" v={`${data.division} · ${data.department}`} />
              <Row k="Material" v={data.material ?? "—"} />
              <Row k="Quoted at" v={label(data.variationLevel)} />
              {data.sizes.length ? (
                <Row k="Sizes" v={data.sizes.join(" · ")} />
              ) : null}
              <Row k="Plan units" v={`${units(data.planUnits)} / yr`} />
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
                      <td className="num">{unitCost(s.currentFob)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            ) : (
              <p style={{ color: "var(--color-fg-muted)" }}>
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
                {Object.entries(data.cleanSheet.buckets).map(([bucket, clean]) => {
                  // The clean sheet is a discount on the real bucket split, so
                  // baseline per bucket is recoverable from it.
                  const baseline = data.baselineFob
                    ? (clean / data.cleanSheet.fob) * data.baselineFob
                    : 0;
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
                    <strong>{unitCost(data.baselineFob)}</strong>
                  </td>
                  <td className="num">
                    <strong>{unitCost(data.cleanSheet.fob)}</strong>
                  </td>
                  <td className="num">
                    <strong>
                      {percent(
                        data.baselineFob
                          ? (data.baselineFob - data.cleanSheet.fob) /
                              data.baselineFob
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
                color: "var(--color-fg-muted)",
                fontSize: "var(--type-caption-size)",
                marginBlockStart: "var(--space-sm)",
              }}
            >
              Clean sheet is internal only. It is never shown to vendors.
            </p>
          </div>

          <div className="section">
            <div className="hd">Readiness</div>
            <dl className="meta-list">
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

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </div>
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
