"use client";

import * as React from "react";

/**
 * The chart layer — four forms, hand-built SVG, no library.
 *
 * Quince Core ships no charts, and pulling one in would mean a dependency whose
 * colours and type live outside the token system. These four are all Wave
 * Insights needs: a horizontal bar for the COO breakdown, a donut for the
 * vendor-type split, a progress-to-cap for vendor spend, and a coverage meter.
 *
 * The palette is VALIDATED, not eyeballed. `scripts/validate_palette.js` from
 * the dataviz procedure was run on both modes and both pass all five checks —
 * lightness band, chroma floor, CVD separation, normal-vision floor, contrast
 * against the surface. The numbers are recorded in globals.css beside the
 * tokens. Dark is a separately chosen set, not an automatic flip: lightening
 * the light palette collapsed cobalt and teal to ΔE 12.7, below the 15 floor.
 *
 * Rules the forms hold to:
 *   - Hues assigned by ENTITY in fixed order, never by rank. Filtering must not
 *     repaint the survivors.
 *   - Status tones (over/under) stay reserved and are never a sixth category.
 *   - Every series is direct-labelled, so identity is never colour-alone.
 *   - Text wears text tokens, never the series colour.
 */

/** Fixed region order. Index into the categorical palette — never re-sorted. */
export const REGION_ORDER = ["CHINA", "ISC", "SEA", "AMERICAS", "EMEA"] as const;

export function regionColor(region: string): string {
  const i = REGION_ORDER.indexOf(region as (typeof REGION_ORDER)[number]);
  // An unknown region gets the neutral, never a generated hue — a 6th category
  // folds into "other" rather than inventing a colour outside the validated set.
  return i >= 0 ? `var(--chart-cat-${i + 1})` : "var(--chart-cat-other)";
}

/* ------------------------------------------------------------------ *
 * Horizontal bar with a range band — the COO breakdown
 * ------------------------------------------------------------------ */

export type RangeBarDatum = {
  label: string;
  /** 0..1 */
  value: number;
  min: number;
  max: number;
  overMax: boolean;
  underMin: boolean;
  /** Formatted for display — the chart never formats money itself. */
  valueLabel: string;
  detail?: string;
};

/**
 * The scale is fixed across every row so bars are comparable, and it leaves
 * headroom past the largest max — a breach has to be able to show how far past
 * it went. Clamping at the bound made 37.7% and 46.1% render identically full.
 */
export function RangeBars({ data }: { data: RangeBarDatum[] }) {
  const ceiling = Math.max(
    ...data.map((d) => Math.max(d.value, d.max)),
    0.35,
  ) * 1.08;
  const pct = (v: number) => `${Math.min(100, (v / ceiling) * 100)}%`;

  return (
    <div className="chart-bars">
      {data.map((d) => (
        <div className="chart-bar-row" key={d.label}>
          <span className="chart-bar-label">
            {/* The swatch carries identity; the label repeats it in text, so
                colour is never the only channel. */}
            <span
              className="chart-swatch"
              style={{ background: regionColor(d.label) }}
              aria-hidden="true"
            />
            {d.label}
          </span>

          <span className="chart-bar-track">
            {/* The allowed range, drawn behind the bar. A threshold you cannot
                see is a threshold the bar cannot explain. */}
            <span
              className="chart-bar-band"
              style={{
                insetInlineStart: pct(d.min),
                inlineSize: `calc(${pct(d.max)} - ${pct(d.min)})`,
              }}
              aria-hidden="true"
            />
            <span
              className={
                d.overMax || d.underMin
                  ? "chart-bar-fill is-outside"
                  : "chart-bar-fill"
              }
              style={{
                inlineSize: pct(d.value),
                background: d.overMax || d.underMin ? undefined : regionColor(d.label),
              }}
            />
          </span>

          <span className="chart-bar-value">
            {d.valueLabel}
            <span className="chart-bar-range">
              {Math.round(d.min * 100)}–{Math.round(d.max * 100)}%
            </span>
          </span>

          <span className="chart-bar-state">
            {d.overMax ? (
              <span className="chart-flag is-over">
                Over by {d.detail ?? ""}
              </span>
            ) : d.underMin ? (
              <span className="chart-flag is-under">
                Under by {d.detail ?? ""}
              </span>
            ) : (
              <span className="chart-flag is-ok">Within range</span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Donut — vendor type split
 * ------------------------------------------------------------------ */

export type DonutSlice = { label: string; value: number; color: string };

export function Donut({
  slices,
  centerLabel,
  centerSub,
}: {
  slices: DonutSlice[];
  centerLabel: string;
  centerSub?: string;
}) {
  const total = slices.reduce((s, d) => s + d.value, 0);
  const size = 132;
  const stroke = 22;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;

  // Offsets computed UP FRONT rather than accumulated inside the map. A
  // closure variable mutated during render is reassigned after render
  // completes, which can desync on a re-render — and a donut whose slices
  // drift is worse than no donut.
  const segments = slices.reduce<
    { slice: DonutSlice; length: number; offset: number }[]
  >((acc, slice) => {
    const length = (total ? slice.value / total : 0) * circumference;
    const offset = acc.length
      ? acc[acc.length - 1].offset + acc[acc.length - 1].length
      : 0;
    acc.push({ slice, length, offset });
    return acc;
  }, []);

  return (
    <div className="chart-donut">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`${centerLabel}. ${slices
          .map((s) => `${s.label} ${Math.round((s.value / (total || 1)) * 100)}%`)
          .join(", ")}`}
      >
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          {segments.map(({ slice, length, offset }) => {
            // The 2px gap between segments is the surface showing through,
            // which is what keeps adjacent slices from bleeding together.
            const drawn = Math.max(0, length - 2);
            return (
              <circle
                key={slice.label}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={slice.color}
                strokeWidth={stroke}
                strokeDasharray={`${drawn} ${circumference - drawn}`}
                strokeDashoffset={-offset}
              />
            );
          })}
        </g>
      </svg>

      {/* `.n` / `.c`, not `.v` / `.s` — `.card .v` is the design system's
          metric-pair value at heading-2 size and outranks a single class, so
          the centre figure rendered 110px wide inside an 88px hole. */}
      <div className="chart-donut-center">
        <span className="n">{centerLabel}</span>
        {centerSub ? <span className="c">{centerSub}</span> : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Progress to cap — vendor spend
 * ------------------------------------------------------------------ */

export function CapBar({
  value,
  cap,
  breached,
}: {
  value: number;
  cap: number;
  breached: boolean;
}) {
  // The cap sits at 80% of the track, leaving room to show an overrun.
  const filled = cap ? Math.min(100, (value / cap) * 80) : 0;
  return (
    <span className="chart-cap">
      <span className="chart-cap-mark" aria-hidden="true" />
      <span
        className={breached ? "chart-cap-fill is-over" : "chart-cap-fill"}
        style={{ inlineSize: `${filled}%` }}
      />
    </span>
  );
}

/**
 * The cap bar in THREE colours — decision N14, 5 Oct.
 *
 * One vendor's spend split by its relationship to each product it won:
 * incumbent (it already supplies that product), existing (it does not, but
 * it is not new to Quince) and new (new to Quince — so never incumbent).
 *
 * A breach is shown as a danger OUTLINE on the track, not by recolouring the
 * fill: the fill now carries three categories, and painting it red would
 * erase the split at exactly the moment it matters most. Status colour is
 * reserved and always ships with text — the Headroom column says "over".
 *
 * Colours: incumbent cat-5, existing cat-2, new cat-4 — the last two match
 * the vendor-type donut. Separation was COMPUTED in both modes (see the CSS).
 *
 * `wave` is the vendor's WAVE-WIDE total (N16). Shown as a tick when the page
 * is filtered, because the cap belongs to the vendor, not the slice — a
 * vendor under cap in Womens can be over it across the wave.
 */
export function SplitCapBar({
  split,
  cap,
  breached,
  wave,
}: {
  split: { incumbent: number; existing: number; new: number };
  cap: number;
  /** Judged on the WAVE-WIDE total, never the slice. */
  breached: boolean;
  /** Present only when filtered and different from the slice total. */
  wave?: number;
}) {
  // The cap sits at 80% of the track, leaving room to show an overrun.
  const pct = (n: number) => (cap ? Math.max(0, (n / cap) * 80) : 0);
  const parts = [
    { key: "incumbent", value: split.incumbent, label: "incumbent" },
    { key: "existing", value: split.existing, label: "existing" },
    { key: "new", value: split.new, label: "new" },
  ].filter((p) => p.value > 0);
  const total = parts.reduce((t, p) => t + p.value, 0);
  const describe = parts
    .map((p) => `${p.label} ${Math.round((p.value / (total || 1)) * 100)}%`)
    .join(", ");

  return (
    <span
      className={breached ? "chart-cap chart-cap--split is-over" : "chart-cap chart-cap--split"}
      role="img"
      aria-label={`${describe || "nothing placed"}${breached ? ", over cap" : ""}`}
      title={describe}
    >
      <span className="chart-cap-mark" aria-hidden="true" />
      {wave !== undefined ? (
        <span
          className="chart-cap-wave"
          aria-hidden="true"
          style={{ insetInlineStart: `${Math.min(100, pct(wave))}%` }}
        />
      ) : null}
      <span className="chart-cap-stack" aria-hidden="true">
        {parts.map((p) => (
          <span
            key={p.key}
            className={`chart-cap-seg is-${p.key}`}
            style={{ inlineSize: `${Math.min(100, pct(p.value))}%` }}
          />
        ))}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Coverage meter
 * ------------------------------------------------------------------ */

export function CoverageMeter({ share }: { share: number }) {
  const pct = Math.max(0, Math.min(1, share)) * 100;
  return (
    <span
      className="chart-meter"
      role="img"
      aria-label={`${pct.toFixed(1)} percent of potential dollars placed`}
    >
      <span className="chart-meter-fill" style={{ inlineSize: `${pct}%` }} />
    </span>
  );
}
