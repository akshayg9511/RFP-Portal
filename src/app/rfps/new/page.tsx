"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, Icon } from "@/ds/components";
import { useSelection } from "@/lib/selection";
import { money, unitCost, units } from "@/lib/format";

/**
 * S2 — selection to RFPs.
 *
 * The split preview is demo moment #1: a selection divides by template, and
 * the user sees the division and the resolution path BEFORE anything is
 * committed. Ends at RFPs created in draft; nomination and issue are S3.
 */

type SplitGroup = {
  templateId: string;
  templateName: string;
  resolutionPath: string;
  suggestedName: string;
  styleCount: number;
  annualSpend: number;
  styles: {
    id: string;
    styleNumber: string;
    name: string;
    subDepartment: string;
    planUnits: number | null;
    baselineFob: number | null;
    hasBaseline: boolean;
    hasCleanSheet: boolean;
  }[];
};

type SplitPreview = {
  totalStyles: number;
  rfpCount: number;
  groups: SplitGroup[];
  unresolved: { id: string; styleNumber: string; name: string }[];
};

export default function NewRfpPage() {
  const router = useRouter();
  const selection = useSelection();

  const [preview, setPreview] = React.useState<SplitPreview | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [names, setNames] = React.useState<Record<string, string>>({});
  const [instructions, setInstructions] = React.useState("");
  const [creating, setCreating] = React.useState(false);

  const styleIds = React.useMemo(
    () => [...selection.selected.keys()],
    [selection.selected],
  );

  React.useEffect(() => {
    if (!styleIds.length) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch("/api/rfps/split-preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ styleIds }),
    })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body?.message ?? "Preview failed");
        return body as SplitPreview;
      })
      .then((body) => {
        if (cancelled) return;
        setPreview(body);
        setNames(
          Object.fromEntries(
            body.groups.map((g) => [g.templateId, g.suggestedName]),
          ),
        );
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [styleIds]);

  async function create() {
    if (!preview) return;
    setCreating(true);
    setError(null);

    try {
      const response = await fetch("/api/rfps", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          groups: preview.groups.map((g) => ({
            templateId: g.templateId,
            name: names[g.templateId],
            instructions,
            styleIds: g.styles.map((s) => s.id),
          })),
        }),
      });

      const body = await response.json();
      if (!response.ok) throw new Error(body?.message ?? "Could not create");

      selection.clear();
      router.push("/rfps");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setCreating(false);
    }
  }

  if (!styleIds.length) {
    return (
      <>
        <div className="page-hd">
          <h1>Create RFP</h1>
        </div>
        <div className="card">
          <div className="card-b">
            <div className="empty">
              <span className="glyph">
                <Icon name="invoice" size="lg" />
              </span>
              <div className="ttl">Nothing selected</div>
              <div className="desc">
                Choose the products to bid on, then come back here. The
                selection splits into one RFP per quotation template.
              </div>
              <div className="acts">
                <Link className="btn btn--secondary" href="/style-sets">
                  Browse style sets
                </Link>
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  const missingName = preview?.groups.some((g) => !names[g.templateId]?.trim());

  return (
    <>
      <div className="page-hd">
        <nav className="crumbs" aria-label="Breadcrumb">
          <Link className="crumb" href="/style-sets">
            Style sets
          </Link>
        </nav>
        <h1>Create RFP</h1>
      </div>

      {error ? (
        <div className="bar bar--danger" style={{ marginBlockEnd: "var(--space-lg)" }}>
          <Icon name="alert_triangle" />
          <div>
            <strong>That did not work.</strong> {error}
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="card">
          <div className="card-b">
            <div className="sk" style={{ blockSize: 28, inlineSize: "45%" }} />
            <div
              className="sk"
              style={{
                blockSize: 16,
                inlineSize: "80%",
                marginBlockStart: "var(--space-md)",
              }}
            />
          </div>
        </div>
      ) : null}

      {preview ? (
        <>
          {/* The split, stated before anything is committed. */}
          <div className="card raised" style={{ marginBlockEnd: "var(--space-lg)" }}>
            <div className="card-b">
              <div className="split-headline">
                <span className="v">{preview.totalStyles}</span>
                <span className="k">products</span>
                <Icon name="arrow_right" />
                <span className="v">{preview.rfpCount}</span>
                <span className="k">
                  {preview.rfpCount === 1 ? "RFP" : "RFPs"}
                </span>
              </div>
              <p style={{ color: "var(--color-fg-muted)", marginBlockStart: "var(--space-sm)" }}>
                {preview.rfpCount > 1
                  ? "These products use different quotation templates, so they become separate RFPs. Each vendor sees only the products in their RFP."
                  : "All of these products share one quotation template."}
              </p>
            </div>
          </div>

          {preview.unresolved.length ? (
            <div className="bar bar--warning" style={{ marginBlockEnd: "var(--space-lg)" }}>
              <Icon name="alert_triangle" />
              <div>
                <strong>
                  {preview.unresolved.length} product
                  {preview.unresolved.length === 1 ? "" : "s"} have no template.
                </strong>{" "}
                They will be left out:{" "}
                {preview.unresolved.map((s) => s.styleNumber).join(", ")}
              </div>
            </div>
          ) : null}

          {preview.groups.map((group) => (
            <div className="card" key={group.templateId} style={{ marginBlockEnd: "var(--space-lg)" }}>
              <div className="card-h">
                <div className="ttl">{group.templateName}</div>
                <div className="sub">
                  {group.styleCount} products · {money(group.annualSpend)} annual
                  spend · template resolves {group.resolutionPath}
                </div>
              </div>

              <div className="card-b">
                <div className="field">
                  <label className="lbl" htmlFor={`name-${group.templateId}`}>
                    RFP name
                  </label>
                  <div className="control">
                    <input
                      id={`name-${group.templateId}`}
                      value={names[group.templateId] ?? ""}
                      onChange={(e) =>
                        setNames((prev) => ({
                          ...prev,
                          [group.templateId]: e.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="msg">
                    Suggested from the template. Must be set before the
                    invitation goes out.
                  </div>
                </div>

                <table className="data-grid" style={{ marginBlockStart: "var(--space-lg)" }}>
                  <thead>
                    <tr>
                      <th>Style</th>
                      <th>Sub-department</th>
                      <th className="num">Plan units</th>
                      <th className="num">Baseline FOB</th>
                      <th>Readiness</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.styles.map((style) => (
                      <tr key={style.id}>
                        <td>
                          <span className="id">{style.styleNumber}</span> ·{" "}
                          {style.name}
                        </td>
                        <td>{style.subDepartment}</td>
                        <td className="num">{units(style.planUnits)}</td>
                        <td className="num">{unitCost(style.baselineFob)}</td>
                        <td>
                          {style.hasBaseline && style.hasCleanSheet ? (
                            <Badge tone="success">Ready</Badge>
                          ) : !style.hasBaseline ? (
                            <Badge tone="danger">No baseline</Badge>
                          ) : (
                            <Badge tone="warning">No clean sheet</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          <div className="card" style={{ marginBlockEnd: "var(--space-lg)" }}>
            <div className="card-h">
              <div className="ttl">Instructions to vendors</div>
              <div className="sub">
                A one-way note, shown on every RFP created here.
              </div>
            </div>
            <div className="card-b">
              <div className="field">
                <div className="control">
                  <textarea
                    rows={3}
                    value={instructions}
                    onChange={(e) => setInstructions(e.target.value)}
                    placeholder="All lead times must assume Q1 shipping. Quote in USD only."
                    aria-label="Instructions to vendors"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="page-actions">
            <Link className="btn btn--secondary" href="/style-sets">
              Back to selection
            </Link>
            <button
              className="btn btn--primary"
              onClick={create}
              disabled={creating || missingName}
            >
              {creating ? (
                <>
                  <span className="spinner" aria-hidden />
                  Creating…
                </>
              ) : (
                <>
                  Create {preview.rfpCount}{" "}
                  {preview.rfpCount === 1 ? "RFP" : "RFPs"}
                </>
              )}
            </button>
          </div>
        </>
      ) : null}
    </>
  );
}
