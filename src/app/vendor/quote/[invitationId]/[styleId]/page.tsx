"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Badge, Icon } from "@/ds/components";
import { useApi } from "@/lib/useApi";
import { ProductGallery, type Colourway } from "@/components/ProductGallery";
import { computeQuote, missingInputs, type QuoteValues } from "@/domain/quote";
import {
  askSummary,
  targetLabel,
  type AskAnchor,
  type AskStatus,
  type AskType,
} from "@/domain/asks";
import { unitCost, units } from "@/lib/format";

/**
 * S5 — quote entry.
 *
 * The form renders from the template definition, so the sections, line items,
 * help text and units are the vendor's own sheet. Only the bucket FORMULAS are
 * per-category, because the two real templates genuinely differ.
 *
 * Everything computes in the browser as the vendor types — the system owns the
 * arithmetic, which is what stops a vendor getting their own total wrong.
 */

type Line = {
  key: string;
  label: string;
  help?: string;
  unit?: string;
  inputType: string;
  derived?: boolean;
};

type Section = { key: string; label: string; lines: Line[]; totalKey: string };

type QuoteForm = {
  invitationId: string;
  round: number;
  vendor: { id: string; name: string };
  rfp: { id: string; name: string; instructions: string | null; dueDate: string | null };
  template: {
    name: string;
    definition: {
      productAxis: string;
      craftingFormula: "CPM_OVER_EFFICIENCY" | "HOURLY_OVER_60";
      materialFormula: "ADDITIVE_PER_METER" | "COST_PER_UOM";
      sections: Section[];
      additionalInformation: Line[] | null;
    };
  };
  style: {
    id: string;
    styleNumber: string;
    name: string;
    material: string | null;
    variationLevel: string;
    planUnits: number | null;
    heroImage: string | null;
    images: string[];
    colourways: Colourway[];
    sizes: string[];
    /**
     * The variations THIS vendor must price, with anything already saved.
     * Empty when the product is bid whole.
     */
    pricedVariations?: {
      id: string;
      label: string;
      consumption: number | null;
      fob: number | null;
    }[];
  };
  quote: {
    status: string;
    values: QuoteValues;
    fob: number | null;
    /**
     * The typed columns. Read only as a FALLBACK: a seeded quote (or one saved
     * before the mapping fix) has its terms in these columns but not in the
     * values blob, and would otherwise render the fields empty and then write
     * that emptiness back.
     */
    maxVolumeCapacity: number | null;
    productionLeadTime: number | null;
    moq: number | null;
    notes: string | null;
  } | null;
  /**
   * Bands and directions only. The clean sheet and every rival's price stay on
   * the server — only the verdict crosses (Build Doc 8.3).
   */
  signals: {
    competitiveness: "STRONG" | "COMPETITIVE" | "NEEDS_WORK" | "OFF_TARGET" | null;
    buckets: { bucket: string; flag: "ABOVE" | "IN_LINE" | "BELOW" }[];
    rank: { band: string; totalBidders: number } | null;
  } | null;
  /**
   * What Quince has asked about this product. The target is a PERCENTAGE — the
   * should-cost figure behind it never crosses (Build Doc 8.2).
   */
  asks: {
    id: string;
    anchor: AskAnchor;
    bucket: string | null;
    fieldPath: string | null;
    type: AskType;
    body: string | null;
    targetPctLo: number | null;
    targetPctHi: number | null;
    status: AskStatus;
    mandatory: boolean;
    valueBefore: string | null;
    valueAfter: string | null;
    reply: string | null;
  }[];
  products: {
    id: string;
    styleNumber: string;
    name: string;
    state: string;
  }[];
};

/**
 * Deliberately plain words. The vendor is being told where they stand, not
 * shown a score they can reverse-engineer — there is no number anywhere here.
 */
const BAND_LABEL: Record<string, string> = {
  STRONG: "Strong",
  COMPETITIVE: "Competitive",
  NEEDS_WORK: "Needs work",
  OFF_TARGET: "Off target",
};

const FLAG_LABEL: Record<string, string> = {
  ABOVE: "Above our model",
  IN_LINE: "In line",
  BELOW: "Below our model",
};

const BUCKET_LABEL: Record<string, string> = {
  BASE_MATERIALS: "Materials",
  TRIM_HARDWARE: "Trim + hardware",
  PACKAGING: "Packaging",
  CRAFTING: "Crafting",
  OVERHEAD_SGA_PROFIT: "Overhead + SG&A",
};

export default function QuotePage() {
  const { invitationId, styleId } = useParams<{
    invitationId: string;
    styleId: string;
  }>();

  const { data, loading, error, reload } = useApi<QuoteForm>(
    `/api/quotes/${invitationId}/${styleId}`,
  );

  /**
   * `edits` holds only what the vendor has TYPED this session; the saved quote
   * comes from `data` and the two merge at read time.
   *
   * This was an effect calling setValues on every fetch, which meant a reload
   * after submit could paint one frame carrying the previous product's numbers.
   * Deriving during render removes the frame and the lint error both.
   */
  const [edits, setEdits] = React.useState<QuoteValues>({});
  const [busy, setBusy] = React.useState(false);
  const [saved, setSaved] = React.useState<string | null>(null);

  /**
   * Per-size price edits, layered over what was saved — the same
   * edits-over-saved shape the values blob uses above, and for the same
   * reason: a refetch must refresh the saved half without discarding what
   * the vendor has typed.
   */
  const [priceEdits, setPriceEdits] = React.useState<
    Record<string, { consumption?: string; fob?: string }>
  >({});

  const priced = React.useMemo(
    () => data?.style.pricedVariations ?? [],
    [data],
  );

  function priceOf(variationId: string, field: "consumption" | "fob"): string {
    const edited = priceEdits[variationId]?.[field];
    if (edited !== undefined) return edited;
    const row = priced.find((v) => v.id === variationId);
    const value = row?.[field];
    return value === null || value === undefined ? "" : String(value);
  }

  function setPrice(
    variationId: string,
    field: "consumption" | "fob",
    value: string,
  ) {
    setPriceEdits((prev) => ({
      ...prev,
      [variationId]: { ...prev[variationId], [field]: value },
    }));
  }

  const values = React.useMemo<QuoteValues>(() => {
    const stored = (data?.quote?.values as QuoteValues) ?? {};
    const q = data?.quote;

    // Backfill the commercial terms from their typed columns where the values
    // blob has nothing — a quote seeded (or saved before the mapping fix) has
    // them in the columns only, and would otherwise render empty.
    const backfill: QuoteValues = {};
    if (q) {
      const pairs = [
        ["maxVolumeCapacity", q.maxVolumeCapacity],
        ["productionLeadTime", q.productionLeadTime],
        ["moq", q.moq],
        ["additionalNotes", q.notes],
      ] as const;
      for (const [key, col] of pairs) {
        if (col !== null && col !== undefined && stored[key] === undefined) {
          backfill[key] = col;
        }
      }
    }

    return { ...stored, ...backfill, ...edits };
  }, [data, edits]);

  /**
   * Note `prev` here is the EDITS, not the merged values — which is what the
   * callers want: spread the edits so far and add one key. A field the vendor
   * has not touched stays absent from edits and keeps falling through to the
   * saved value.
   */
  const setValues = setEdits;

  const spec = React.useMemo(() => {
    const def = data?.template.definition;
    const keysOf = (key: string) =>
      (def?.sections.find((s) => s.key === key)?.lines ?? [])
        .filter((l) => !l.derived && l.inputType === "currency")
        .map((l) => l.key);

    return {
      craftingFormula: def?.craftingFormula ?? "CPM_OVER_EFFICIENCY",
      materialFormula: def?.materialFormula ?? "ADDITIVE_PER_METER",
      trimKeys: keysOf("TRIM_HARDWARE"),
      packagingKeys: keysOf("PACKAGING"),
    };
  }, [data]);

  // Recomputed on every keystroke. This is the whole point of the screen.
  const computed = React.useMemo(
    () => computeQuote(values, spec),
    [values, spec],
  );
  const missing = React.useMemo(
    () => missingInputs(values, spec),
    [values, spec],
  );

  async function save(status: "DRAFT" | "SUBMITTED") {
    setBusy(true);
    try {
      const response = await fetch(`/api/quotes/${invitationId}/${styleId}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          values,
          bucketTotals: computed.buckets,
          fob: computed.fob,
          status,
          // The complete set every save, so a row for a variation the buyer
          // has since removed cannot linger.
          prices: Object.fromEntries(
            priced.map((v) => [
              v.id,
              {
                consumption: numOrNull(priceOf(v.id, "consumption")),
                fob: numOrNull(priceOf(v.id, "fob")),
              },
            ]),
          ),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.message ?? "Could not save");
      setSaved(
        status === "SUBMITTED"
          ? `Submitted. ${body.submittedCount} of ${body.productCount} products done.`
          : "Draft saved.",
      );
      // Stay on the page after submitting, and RELOAD — submission is the
      // moment the score panel appears, and bouncing straight to the dashboard
      // meant a vendor never saw the one piece of feedback the system gives
      // them back.
      if (status === "SUBMITTED") reload();
    } catch (err: unknown) {
      setSaved(err instanceof Error ? err.message : String(err));
    }
    setBusy(false);
  }

  if (error) {
    return (
      <div className="bar bar--danger">
        <Icon name="alert_triangle" />
        <div><strong>Could not open that quote.</strong> {error}</div>
      </div>
    );
  }

  if (loading || !data) {
    return (
      <div className="card"><div className="card-b">
        <div className="sk" style={{ blockSize: 24, inlineSize: "40%" }} />
      </div></div>
    );
  }

  const def = data.template.definition;
  const derived: Record<string, number> = {
    coreMaterialCost: computed.coreMaterialCost,
    totalFabricCost: computed.coreMaterialCost,
    totalMaterialCost: computed.buckets.BASE_MATERIALS,
    totalTrimCost: computed.buckets.TRIM_HARDWARE,
    totalPackagingCost: computed.buckets.PACKAGING,
    coreCraftingCost: computed.coreCraftingCost,
    totalCraftingCost: computed.buckets.CRAFTING,
    totalSam: computed.totalSam,
    overheadPercent: computed.overheadPercent * 100,
  };

  return (
    <>
      <div className="page-hd">
        <nav className="crumbs" aria-label="Breadcrumb">
          <Link className="crumb" href="/vendor">Your RFPs</Link>
        </nav>
        <div className="row">
          <div className="grow">
            <h1 className="ttl">{data.style.name}</h1>
            <p className="page-sub">
              {data.style.styleNumber} · {data.rfp.name} · quoting in USD
            </p>
          </div>
          <div className="acts">
            <button
              className="btn btn--secondary"
              onClick={() => save("DRAFT")}
              disabled={busy}
            >
              Save draft
            </button>
            <button
              className="btn btn--primary"
              onClick={() => save("SUBMITTED")}
              disabled={busy || missing.length > 0}
            >
              Submit quote
            </button>
          </div>
        </div>
      </div>

      {saved ? (
        <div className="bar bar--success" style={{ marginBlockEnd: "var(--space-lg)" }}>
          <Icon name="check_circle" />
          <div>{saved}</div>
        </div>
      ) : null}

      {/* ASKS FIRST. Feedback the vendor has not seen is the reason they opened
          this page in round two, and burying it under the form means they
          re-submit without addressing it. */}
      {data.asks.length ? (
        <div className={askSummary(data.asks).outstanding ? "bar bar--warning" : "bar bar--success"}>
          <Icon name={askSummary(data.asks).outstanding ? "alert_triangle" : "check"} />
          <div>
            <strong>
              {askSummary(data.asks).outstanding
                ? `Quince has ${askSummary(data.asks).outstanding} request${askSummary(data.asks).outstanding === 1 ? "" : "s"} on this product.`
                : "All requests on this product are resolved."}
            </strong>
            <ul className="ask-list">
              {data.asks.map((a) => (
                <li className={`ask ask--${a.status.toLowerCase()}`} key={a.id}>
                  <span className="ask-state">
                    {a.status === "ADDRESSED"
                      ? "Updated"
                      : a.status === "RESOLVED"
                        ? "Resolved"
                        : a.status === "REOPENED"
                          ? "Reopened"
                          : "Open"}
                  </span>
                  <span className="ask-text">
                    {a.bucket ? (
                      <strong>{BUCKET_LABEL[a.bucket] ?? a.bucket}</strong>
                    ) : null}{" "}
                    {a.body}
                    {targetLabel(a) ? (
                      <span className="ask-target"> — {targetLabel(a)}</span>
                    ) : null}
                    {/* Before/after, recorded automatically. The vendor can
                        see exactly what their change did. */}
                    {a.valueBefore && a.valueAfter ? (
                      <span className="ask-delta">
                        {" "}
                        was {a.valueBefore} · now {a.valueAfter}
                      </span>
                    ) : null}
                    {a.reply ? (
                      <span className="ask-reply">Quince: {a.reply}</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {data.rfp.instructions ? (
        <div className="bar bar--info" style={{ marginBlockEnd: "var(--space-lg)" }}>
          <Icon name="info_circle" />
          <div><strong>Instructions.</strong> {data.rfp.instructions}</div>
        </div>
      ) : null}

      <div className="quote-layout">
        <div>
          {/* PER-SIZE PRICE — first, because it is what the buyer asked for
              and the breakdown below explains it.

              Rows, not one form per size: the worst-case vendor here holds 9
              variation groups, and a page each would be 9 navigations to
              submit one bid. The real Lauren Home template is one sheet with
              a column per size, which is this. */}
          {priced.length ? (
            <div
              className="card"
              style={{ marginBlockEnd: "var(--space-lg)" }}
            >
              <div className="card-h">
                <div className="ttl">Price per variation</div>
              </div>
              <div className="card-b">
                <p className="quote-side-note" style={{ marginBlockStart: 0 }}>
                  The cost breakdown below is shared across these — only
                  consumption and FOB change by variation.
                </p>
                <div className="data-grid-surface">
                  <table className="data-grid">
                    <thead>
                      <tr>
                        <th>Variation</th>
                        <th className="num">Consumption</th>
                        <th className="num">FOB</th>
                      </tr>
                    </thead>
                    <tbody>
                      {priced.map((v) => (
                        <tr key={v.id}>
                          <td>{v.label}</td>
                          <td className="num">
                            <input
                              className="control sm num"
                              type="number"
                              min={0}
                              step="0.0001"
                              value={priceOf(v.id, "consumption")}
                              onChange={(e) =>
                                setPrice(v.id, "consumption", e.target.value)
                              }
                              aria-label={`Consumption for ${v.label}`}
                            />
                          </td>
                          <td className="num">
                            <input
                              className="control sm num"
                              type="number"
                              min={0}
                              step="0.01"
                              value={priceOf(v.id, "fob")}
                              onChange={(e) =>
                                setPrice(v.id, "fob", e.target.value)
                              }
                              aria-label={`FOB for ${v.label}`}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : null}

          {def.sections.map((section) => (
            <div className="card" key={section.key} style={{ marginBlockEnd: "var(--space-lg)" }}>
              <div className="card-h">
                <div className="ttl">{section.label}</div>
                <div className="sub">
                  <span>{BUCKET_LABEL[section.key]}</span>
                  <span className="quote-section-total">
                    {unitCost(
                      computed.buckets[
                        section.key as keyof typeof computed.buckets
                      ],
                    )}
                  </span>
                </div>
              </div>
              <div className="card-b">
                {section.lines.map((line) => (
                  <div className="quote-line" key={line.key}>
                    <label className="quote-line-label" htmlFor={line.key}>
                      {line.label}
                      {line.help ? (
                        <span className="quote-line-help">{line.help}</span>
                      ) : null}
                    </label>

                    {line.derived ? (
                      <output className="quote-line-derived" id={line.key}>
                        {line.inputType === "percent"
                          ? `${(derived[line.key] ?? 0).toFixed(1)}%`
                          : line.inputType === "minutes"
                            ? `${(derived[line.key] ?? 0).toFixed(0)} min`
                            : unitCost(derived[line.key] ?? 0)}
                      </output>
                    ) : (
                      <div className="control quote-line-input">
                        <input
                          id={line.key}
                          type={line.inputType === "text" ? "text" : "number"}
                          step="any"
                          // A cost cannot be negative, and neither can a
                          // quantity or a rate.
                          min={line.inputType === "text" ? undefined : 0}
                          value={(values[line.key] as string | number) ?? ""}
                          onChange={(e) =>
                            setValues((prev) => ({
                              ...prev,
                              [line.key]:
                                line.inputType === "text"
                                  ? e.target.value
                                  : e.target.value === ""
                                    ? ""
                                    : Number(e.target.value),
                            }))
                          }
                        />
                        {line.unit ? (
                          <span className="affix">{line.unit}</span>
                        ) : null}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}

          {def.additionalInformation ? (
            <div className="card" style={{ marginBlockEnd: "var(--space-2xl)" }}>
              <div className="card-h">
                <div className="ttl">Additional information</div>
                <div className="sub">Commercial terms — never part of your FOB</div>
              </div>
              <div className="card-b">
                {def.additionalInformation.map((line) => (
                  <div className="quote-line" key={line.key}>
                    <label className="quote-line-label" htmlFor={line.key}>
                      {line.label}
                      {line.help ? (
                        <span className="quote-line-help">{line.help}</span>
                      ) : null}
                    </label>
                    <div className="control quote-line-input">
                      <input
                        id={line.key}
                        type={line.inputType === "text" ? "text" : "number"}
                        value={(values[line.key] as string | number) ?? ""}
                        onChange={(e) =>
                          setValues((prev) => ({
                            ...prev,
                            [line.key]: e.target.value,
                          }))
                        }
                      />
                      {line.unit ? <span className="affix">{line.unit}</span> : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {/* The running total, pinned. It moves as they type. */}
        <aside className="quote-side">
          <div className="card raised">
            <div className="card-b">
              {/* A vendor is pricing this product and could previously see one
                  photograph of it. */}
              <ProductGallery
                key={styleId}
                images={data.style.images}
                colourways={data.style.colourways}
                alt={data.style.name}
                compact
              />

              <div className="quote-total">
                <div className="k">Your FOB</div>
                <div className="v">{unitCost(computed.fob)}</div>
              </div>

              <dl className="quote-buckets">
                {Object.entries(computed.buckets).map(([key, value]) => (
                  <React.Fragment key={key}>
                    <dt>{BUCKET_LABEL[key] ?? key}</dt>
                    <dd>{unitCost(value)}</dd>
                  </React.Fragment>
                ))}
              </dl>

              {/* THE SIGNAL — the one thing the system gives the vendor back.
                  Appears only after submitting: a live band would turn the form
                  into a guessing game against a target they cannot see. */}
              {data.signals ? (
                <div className="score">
                  <div className="score-hd">Your bid</div>

                  {data.signals.competitiveness ? (
                    <div
                      className={`score-band is-${data.signals.competitiveness.toLowerCase()}`}
                    >
                      <span className="dot" aria-hidden="true" />
                      <span className="n">
                        {BAND_LABEL[data.signals.competitiveness]}
                      </span>
                    </div>
                  ) : null}

                  <p className="score-note">
                    {data.signals.rank
                      ? `Measured against our cost model and the ${data.signals.rank.totalBidders} bids received.`
                      : "Measured against our cost model."}
                  </p>

                  {data.signals.buckets.length ? (
                    <>
                      <div className="score-sub">Where your costs sit</div>
                      <dl className="score-buckets">
                        {data.signals.buckets.map((b) => (
                          <React.Fragment key={b.bucket}>
                            <dt>{BUCKET_LABEL[b.bucket] ?? b.bucket}</dt>
                            <dd className={`flag is-${b.flag.toLowerCase()}`}>
                              {FLAG_LABEL[b.flag]}
                            </dd>
                          </React.Fragment>
                        ))}
                      </dl>
                    </>
                  ) : null}
                </div>
              ) : null}

              {data.style.planUnits ? (
                <p className="quote-side-note">
                  {units(data.style.planUnits)} units a year
                  {/* Was "quoted at style level across N sizes". That became
                      false the moment a vendor could be nominated per size,
                      so it now reports what is actually being asked for. */}
                  {priced.length
                    ? ` · priced per ${priced.length === 1 ? "variation" : `${priced.length} variations`}`
                    : ""}
                </p>
              ) : null}

              {missing.length ? (
                <div className="bar bar--warning" style={{ marginBlockStart: "var(--space-md)" }}>
                  <Icon name="alert_triangle" />
                  <div>
                    <strong>{missing.length} inputs still needed</strong> before
                    you can submit.
                  </div>
                </div>
              ) : (
                <div className="bar bar--success" style={{ marginBlockStart: "var(--space-md)" }}>
                  <Icon name="check_circle" />
                  <div>Ready to submit.</div>
                </div>
              )}
            </div>
          </div>

          <div className="card" style={{ marginBlockStart: "var(--space-lg)" }}>
            <div className="card-h"><div className="ttl">Products in this RFP</div></div>
            <div className="card-b quote-nav">
              {data.products.map((p) => (
                <Link
                  key={p.id}
                  href={`/vendor/quote/${invitationId}/${p.id}`}
                  className={p.id === styleId ? "quote-nav-item on" : "quote-nav-item"}
                >
                  <span className="id">{p.styleNumber}</span>
                  <span className="nm">{p.name}</span>
                  {p.state === "SUBMITTED" ? (
                    <Badge tone="success">Done</Badge>
                  ) : p.state === "DRAFT" ? (
                    <Badge tone="warning">Draft</Badge>
                  ) : null}
                </Link>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}

/** "" and a non-number both mean "not quoted", not zero. */
function numOrNull(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}
