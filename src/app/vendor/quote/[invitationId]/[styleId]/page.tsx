"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Badge, Icon } from "@/ds/components";
import { useApi } from "@/lib/useApi";
import { ProductGallery, type Colourway } from "@/components/ProductGallery";
import { BidStatusInfo } from "@/components/BidStatusInfo";
import { BidThread, type ThreadMessage } from "@/components/BidThread";
import { computeQuote, missingInputs, type QuoteValues } from "@/domain/quote";
import {
  askSummary,
  targetLabel,
  type AskAnchor,
  type AskStatus,
  type AskType,
} from "@/domain/asks";
import { unitCost, units } from "@/lib/format";
import {
  canVendorWithdraw,
  templateFor,
  vendorCanEdit,
  vendorStatus,
  turnOf,
  type BidStatus,
} from "@/domain/bidStatus";
import { WithdrawAction } from "@/components/WithdrawAction";
import { QuoteActionsMenu } from "@/components/QuoteActionsMenu";
import { SubmitQuoteModal } from "@/components/SubmitQuoteModal";

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
      status: string | null;
      fob: number | null;
      /** This variant's OWN complete breakdown (H8.5). */
      values: QuoteValues;
      bucketTotals: Record<string, number>;
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
    dutyType: string | null;
    /** Three US destinations x two modes. Unsuffixed = ocean. */
    ddpWest: number | null;
    ddpCentral: number | null;
    ddpEast: number | null;
    ddpWestAir: number | null;
    ddpCentralAir: number | null;
    ddpEastAir: number | null;
  } | null;
  /** The ladder position — decides the template depth and who may type. */
  bidStatus: BidStatus;
  bidStatusNote: string | null;
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

/**
 * Field keys in the vendor's own words.
 *
 * `missingInputs()` returns KEYS, which are the template's internal names.
 * Printing `greyCostPerMeter` at a vendor is the same class of leak as
 * showing them an RFP name.
 */
const MISSING_LABEL: Record<string, string> = {
  // The light template's buckets.
  materials: "materials total",
  trim: "trim & hardware total",
  packaging: "packaging total",
  crafting: "crafting total",
  overhead: "overhead & profit",
  // The full template's line items.
  consumption: "fabric consumption",
  greyCostPerMeter: "grey fabric cost per metre",
  costPerUom: "fabric cost per unit",
  directLaborRate: "direct labour rate",
  lineEfficiency: "line efficiency",
  sam: "SAM (minutes)",
  hourlyWage: "hourly wage",
  sewingSam: "sewing SAM",
  overheadCost: "overhead & profit",
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
   * `variantEdits` (below) holds only what the vendor has TYPED this session,
   * keyed by variant; the saved quotes come from `data` and the two merge at
   * read time.
   *
   * This was an effect calling setValues on every fetch, which meant a reload
   * after submit could paint one frame carrying the previous product's numbers.
   * Deriving during render removes the frame and the lint error both.
   */
  const [busy, setBusy] = React.useState(false);
  const [saved, setSaved] = React.useState<string | null>(null);

  const priced = React.useMemo(
    () => data?.style.pricedVariations ?? [],
    [data],
  );

  /**
   * WHICH VARIANT IS BEING QUOTED.
   *
   * F7/H8.5: each variant gets its own COMPLETE quote, not a shared
   * breakdown with a per-size price. So the form edits one variant at a
   * time and a selector switches between them — 41 fields x 5 sizes is 205
   * inputs, which is why Apply-to-all exists below rather than as a nicety.
   *
   * null = the whole product, which is what a STYLE-grained product means
   * and what `priced` being empty gives us. The degenerate case of one code
   * path, not a branch.
   */
  const [activeVariation, setActiveVariation] = React.useState<string | null>(
    null,
  );

  // Default to the first variant once the payload lands, so the form never
  // opens on "select a variation first" — Aravind was explicit that a gate
  // there is a cumbersome extra step.
  React.useEffect(() => {
    if (activeVariation === null && priced.length) {
      setActiveVariation(priced[0]!.id);
    }
  }, [priced, activeVariation]);

  const activeRow = priced.find((v) => v.id === activeVariation) ?? null;

  /** Edits are keyed BY VARIANT, so switching away does not lose typing. */
  const [variantEdits, setVariantEdits] = React.useState<
    Record<string, QuoteValues>
  >({});

  const editKey = activeVariation ?? "@STYLE";

  /**
   * DDP — ONE BLOCK PER PRODUCT, six fees.
   *
   * Three US destinations (West/LAX, Central/ORD, East/JFK) x two modes
   * (air, ocean), exactly as the real Radnik template asks them. Each total
   * is simply FOB + that destination's fee for that mode, which is what the
   * template's own formula does (`=E$65+E66`), so there is no new
   * arithmetic here — only new inputs.
   *
   * The toggle is PER PRODUCT (Build Doc 3.6), so these are not keyed by
   * variant; the route fans them across every variant row on save.
   */
  const DDP_FEES = [
    { key: "west", label: "US West", hint: "LAX", mode: "SHIP" },
    { key: "central", label: "US Central", hint: "ORD", mode: "SHIP" },
    { key: "east", label: "US East", hint: "JFK", mode: "SHIP" },
    { key: "westAir", label: "US West", hint: "LAX", mode: "AIR" },
    { key: "centralAir", label: "US Central", hint: "ORD", mode: "AIR" },
    { key: "eastAir", label: "US East", hint: "JFK", mode: "AIR" },
  ] as const;

  type DdpKey = (typeof DDP_FEES)[number]["key"];

  const [ddpEdits, setDdpEdits] = React.useState<
    Partial<Record<DdpKey, string>>
  >({});
  /** null until the vendor touches it, so the SAVED value decides first. */
  const [ddpToggle, setDdpToggle] = React.useState<boolean | null>(null);

  const savedDdp = React.useCallback(
    (key: DdpKey): number | null => {
      const q = data?.quote;
      if (!q) return null;
      const map: Record<DdpKey, number | null> = {
        west: q.ddpWest,
        central: q.ddpCentral,
        east: q.ddpEast,
        westAir: q.ddpWestAir,
        centralAir: q.ddpCentralAir,
        eastAir: q.ddpEastAir,
      };
      return map[key];
    },
    [data],
  );

  function ddpOf(key: DdpKey): string {
    const edited = ddpEdits[key];
    if (edited !== undefined) return edited;
    const stored = savedDdp(key);
    return stored === null ? "" : String(stored);
  }

  /**
   * DDP is on when the vendor says so, else when the saved quote already
   * declares VDDP. Edits-over-saved, the same shape as every other field
   * here — so a refetch cannot flip the toggle back under the vendor.
   */
  const ddpOn = ddpToggle ?? data?.quote?.dutyType === "VDDP";

  /**
   * THE LADDER DECIDES THE DEPTH, AND WHO MAY TYPE.
   *
   * One stored status; domain/bidStatus.ts owns both answers so there is no
   * second source of truth about either. A missing ProductBid reads as
   * INVITED, the floor of the ladder.
   */
  /**
   * Which bucket a typed total goes into (J1). Mirrors BUCKET_INPUT in
   * domain/quote.ts — the same keys, because they are the template's own
   * derived-line keys being filled by hand.
   */
  const BUCKET_INPUT_KEY: Record<string, string> = {
    BASE_MATERIALS: "totalMaterialCost",
    TRIM_HARDWARE: "totalTrimCost",
    PACKAGING: "totalPackagingCost",
    CRAFTING: "totalCraftingCost",
    OVERHEAD_SGA_PROFIT: "overheadCost",
  };

  const bidStatus: BidStatus = data?.bidStatus ?? "INVITED";
  const template = templateFor(bidStatus);
  const isLight = template === "LIGHT";
  const canEdit = vendorCanEdit(bidStatus);
  const canWithdraw = canVendorWithdraw(bidStatus);

  /** The two modal surfaces the collapsed action row opens (L1/L2). */
  const [submitOpen, setSubmitOpen] = React.useState(false);
  // UX v2: Bid details · Comments, with Quince's latest note as a bar.
  const [tab, setTab] = React.useState<"details" | "comments">("details");
  const [barDismissed, setBarDismissed] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const bid = useApi<{ statusNote: string | null; comments: ThreadMessage[] }>(
    `/api/bids/${invitationId}/${styleId}?side=VENDOR`,
  );
  async function sendMessage(body: string) {
    setSending(true);
    try {
      await fetch(`/api/bids/${invitationId}/${styleId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ authorSide: "VENDOR", authorName: data?.vendor.name, note: body }),
      });
      bid.reload();
    } finally {
      setSending(false);
    }
  }
  const [withdrawOpen, setWithdrawOpen] = React.useState(false);

  /**
   * Withdraw, with the reason the vendor gave (J4/J9).
   *
   * Goes through the bid route, not the quote route: withdrawal is a LADDER
   * move, and that route is what posts the note into the thread so Quince
   * reads it in the same chronology as everything else.
   */
  async function withdrawNow(reason: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/bids/${invitationId}/${styleId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          to: "WITHDRAWN",
          note: reason,
          authorSide: "VENDOR",
          authorName: data?.vendor.name ?? null,
        }),
      });
      const b = await res.json();
      if (!res.ok) throw new Error(b?.message ?? "Could not withdraw");
      setSaved("You have withdrawn from this product. You can reinstate it at any time.");
      reload();
    } catch (e) {
      setSaved(e instanceof Error ? e.message : "Could not withdraw");
    } finally {
      setBusy(false);
    }
  }

  const values = React.useMemo<QuoteValues>(() => {
    /**
     * The ACTIVE VARIANT's own saved breakdown, falling back to the
     * product-level row. A style-grained product has no variants, so it
     * reads `quote` — the same path, one group.
     */
    const stored = ((activeRow?.values ??
      data?.quote?.values) as QuoteValues) ?? {};
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

    return { ...stored, ...backfill, ...(variantEdits[editKey] ?? {}) };
  }, [data, activeRow, variantEdits, editKey]);

  /**
   * Edits land under the ACTIVE VARIANT's key, so switching variant keeps
   * both sets. A field the vendor has not touched stays absent and keeps
   * falling through to that variant's saved value.
   */
  const setValues = React.useCallback(
    (next: QuoteValues | ((prev: QuoteValues) => QuoteValues)) => {
      setVariantEdits((all) => {
        const mine = all[editKey] ?? {};
        return {
          ...all,
          [editKey]: typeof next === "function" ? next(mine) : next,
        };
      });
    },
    [editKey],
  );

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
  /**
   * What is still needed before this variant can be submitted.
   *
   * Template-aware: at LIGHT the five bucket totals satisfy it, at FULL the
   * line items do. Reading it from the stored status rather than a second
   * flag keeps one source of truth about which template is being asked for.
   */
  const missing = React.useMemo(
    () =>
      missingInputs(values, {
        ...spec,
        template: templateFor(
          (data?.bidStatus ?? "INVITED") as BidStatus,
        ) as "LIGHT" | "FULL",
      }),
    [values, spec, data],
  );

  /** Buckets whose figure came from a typed total rather than line items. */
  const overridden: string[] = computed.overriddenBuckets;

  /**
   * True when the LINE ITEMS are driving this bucket, so the typed field
   * becomes a read-only echo. The precedence is domain-owned (J1): detail
   * beats an estimate, and the form shows which it is rather than silently
   * replacing a number the vendor typed.
   */
  /**
   * WHICH VARIANTS ARE NOT READY — J2.
   *
   * Submit-all is blocked by any variant without a price, and NAMES it, so
   * the vendor is never left guessing which of five is holding them up. A
   * variant already submitted is complete by definition.
   */
  const incomplete = React.useMemo(
    () =>
      priced
        .filter((v) => v.status !== "SUBMITTED" && (v.fob ?? 0) <= 0)
        .map((v) => v.label),
    [priced],
  );

  /**
   * Submit every variant in one action. Sequential rather than parallel: the
   * route recomputes the invitation's own status on each save, and two
   * concurrent writes to that row race.
   */
  /**
   * Submit the variations the modal selected (L2).
   *
   * `only` is the picked set; omitting it submits everything unsubmitted,
   * which is what a style-grained product (no variants) needs.
   */
  async function submitAll(only?: string[]) {
    const pick = only && only.length ? new Set(only) : null;
    setBusy(true);
    try {
      for (const v of priced) {
        if (v.status === "SUBMITTED") continue;
        if (pick && !pick.has(v.id)) continue;
        const r = await fetch(`/api/quotes/${invitationId}/${styleId}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            variationId: v.id,
            status: "SUBMITTED",
            // Each variant submits ITS OWN saved figures. Sending the form's
            // current values would overwrite four variants with the fifth's
            // numbers — the "$21.98 five times" bug in a new place.
            values: v.values,
            bucketTotals: v.bucketTotals,
            fob: v.fob,
          }),
        });
        if (!r.ok) {
          const b = await r.json();
          throw new Error(b?.message ?? "Could not submit");
        }
      }
      const n = pick ? pick.size : priced.length;
      setSaved(
        `Submitted ${n} variation${n === 1 ? "" : "s"}.`,
      );
      setSubmitOpen(false);
      reload();
    } catch (e) {
      setSaved(e instanceof Error ? e.message : "Could not submit");
    } finally {
      setBusy(false);
    }
  }

  function derivedBucket(key: string): boolean {
    /**
     * OVERHEAD IS NEVER DERIVED.
     *
     * `overheadCost` is a single input that IS its own bucket total, so the
     * generic rule ("has a value and was not typed → the line items own
     * it") locked the field the moment the vendor typed into it: they could
     * enter overhead once and never correct it. There is no detail behind
     * this bucket to take precedence.
     */
    if (key === "OVERHEAD_SGA_PROFIT") return false;

    const total =
      computed.buckets[key as keyof typeof computed.buckets] ?? 0;
    return total > 0 && !overridden.includes(key);
  }

  async function save(
    status: "DRAFT" | "SUBMITTED",
    opts: { applyToAll?: boolean } = {},
  ) {
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
          /**
           * Which variant this save is FOR. Omitting it means the whole
           * product, which is what a STYLE-grained product means.
           */
          variationId: activeVariation,
          applyToAll: opts.applyToAll ?? false,
          /**
           * DDP is declared once per PRODUCT, so it rides along with
           * whichever variant is being saved and the route fans it across
           * the rest. Sent only when the vendor has opted in — an absent
           * block leaves the stored fees alone.
           */
          dutyType: ddpOn ? "VDDP" : "QDDP",
          ddp: ddpOn
            ? {
                west: numOrNull(ddpOf("west")),
                central: numOrNull(ddpOf("central")),
                east: numOrNull(ddpOf("east")),
                westAir: numOrNull(ddpOf("westAir")),
                centralAir: numOrNull(ddpOf("centralAir")),
                eastAir: numOrNull(ddpOf("eastAir")),
              }
            : {
                west: null,
                central: null,
                east: null,
                westAir: null,
                centralAir: null,
                eastAir: null,
              },
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.message ?? "Could not save");
      setSaved(
        status === "SUBMITTED"
          ? `Submitted. ${body.submittedCount} of ${body.productCount} products done.`
          : "Draft saved.",
      );
      /**
       * RELOAD ON EVERY SAVE, not only on submit.
       *
       * Submission is the moment the score panel appears, which is why this
       * reloaded then. But a DRAFT save now changes other variants too —
       * Copy-to-all writes four more rows — and without a reload the tabs
       * kept showing "—" for prices that were already in MySQL. It read as
       * "nothing saved" when everything had.
       *
       * Safe because the form derives its values edits-over-saved: a reload
       * refreshes the saved half and leaves what the vendor has typed.
       */
      reload();
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
      {/* Header and variation selection stay put on scroll (C62). */}
      <div className="vq-sticky">
      <div className="page-hd">
        {/* The vendor has no RFPs (H4), so the crumb goes back to the
            product list and the RFP name is nowhere on this page either. */}
        <nav className="crumbs" aria-label="Breadcrumb">
          <Link className="crumb" href="/vendor">Products to bid</Link>
        </nav>
        <div className="row">
          <div className="grow">
            {/* The status lives beside the title, the lifecycle behind ⓘ
                (Aravind, C57 / C58). */}
            <div className="vq-title">
              <h1 className="ttl">{data.style.name}</h1>
              <Badge tone={canEdit ? "warning" : undefined}>{vendorStatus(bidStatus)}</Badge>
              <BidStatusInfo status={bidStatus} />
            </div>
            <p className="page-sub">
              {data.style.styleNumber} · quoting in USD ·{" "}
              {isLight
                ? "bucket totals only for now"
                : "full costing"}
            </p>
          </div>
          <div className="acts">
            {/* TWO CONTROLS, NOT FIVE — decision L1, 5 Oct.
            
                Akshay: "couple 5 option into 1 or 2 or max 3 option and
                within option add dropdowns."
            
                This row was Withdraw · Copy to all · Save draft · Submit
                this one · Submit all. Two of those were submits, so the
                SCOPE of the commit was being decided in a button label,
                competing with three other actions. The design system's own
                rule is that bulk actions collapse into one ghost menu and a
                screen carries one primary.
            
                So: everything secondary goes behind "More", and Submit opens
                the modal where the scope is the content (L2). */}
            {canEdit || canWithdraw ? (
              <QuoteActionsMenu
                canEdit={canEdit}
                canWithdraw={canWithdraw}
                hasVariants={priced.length > 1}
                busy={busy}
                onCopyAll={() => save("DRAFT", { applyToAll: true })}
                onSaveDraft={() => save("DRAFT")}
                onWithdraw={() => setWithdrawOpen(true)}
              />
            ) : null}

            {canEdit ? (
              <button
                className="btn btn--primary"
                onClick={() => setSubmitOpen(true)}
                disabled={busy}
              >
                Submit quote
              </button>
            ) : null}
          </div>
        </div>
      </div>
        {/* WHICH VARIATION — full width, above the summary, and held with
            the header while the form scrolls (Aravind, C60 / C62). Every
            variant carries its own complete quote, so the form edits one at a
            time; absent at STYLE grain, where a one-item selector reads as
            broken. Only on Bid details — the conversation is per product. */}
        {tab === "details" && priced.length > 1 ? (
          <div className="vq-variations">
            <div className="vq-variations-h">
              <span className="ttl">Which variation</span>
              <span className="qv-count">
                {priced.filter((v) => v.status === "SUBMITTED").length} of {priced.length} submitted
              </span>
              <span className="quote-side-note">
                Fill one, then <strong>copy it to the rest</strong> from More — a variation
                you have already submitted is never overwritten.
              </span>
            </div>
            <div className="qv-tabs" role="tablist">
              {priced.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  role="tab"
                  aria-selected={v.id === activeVariation}
                  className={`qv-tab${v.id === activeVariation ? " on" : ""}`}
                  onClick={() => setActiveVariation(v.id)}
                >
                  <span className="qv-tab-l">{v.label}</span>
                  <span className="qv-tab-v">{v.fob === null ? "—" : unitCost(v.fob)}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {/* J12 — NOMINATED WHOLE ON A PER-SIZE PRODUCT.
      
          Akshay reported "I do not see all variants" on a product that is
          SIZE grain with 5 variations. The form was right: that vendor's
          InvitationStyle genuinely had no variation rows, so they were
          invited whole. The RFP carried all five on RfpStyle — the
          variations were lost at NOMINATION, not at RFP creation.
      
          Not silently fixed, because re-nominating an ISSUED RFP is a buyer
          action (the §5.5 addendum flow, deliberately out of scope). So the
          vendor is TOLD, rather than left wondering where the sizes went,
          and the conversation is the route back. */}
      {data.style.variationLevel !== "STYLE" && !priced.length ? (
        <div className="bar bar--warning" style={{ marginBlockEnd: "var(--space-lg)" }}>
          <Icon name="alert_triangle" />
          <div>
            <strong>You were asked to quote this product as a whole.</strong>{" "}
            Quince normally prices it per{" "}
            {data.style.variationLevel === "SIZE"
              ? "size"
              : data.style.variationLevel === "COLOUR"
                ? "colour"
                : "colour and size"}
            . If that looks wrong, ask them in the conversation before you
            quote.
          </div>
        </div>
      ) : null}

      {/* Name the blocker (J2) rather than leaving a disabled button
          unexplained — the DS's rule about disabled controls needing a
          reason, and the practical one that "which of my five?" is the
          question a vendor would otherwise have to answer by clicking. */}
      {canEdit && priced.length > 1 && incomplete.length ? (
        <div className="bar" style={{ marginBlockEnd: "var(--space-lg)" }}>
          <Icon name="info_circle" />
          <div>
            <strong>
              {incomplete.length} variation
              {incomplete.length === 1 ? "" : "s"} still need a price:
            </strong>{" "}
            {incomplete.join(", ")}. You can still submit the ones that are
            ready.
          </div>
        </div>
      ) : null}

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

      {/* THE TWO MODAL SURFACES (L1/L2).
      
          Submit opens with every priced variation pre-ticked, so the normal
          case is one click and the scope is visible rather than encoded in a
          button label. Withdraw keeps its required-note step; it moved from
          the action row into this modal when the row collapsed. */}
      {submitOpen ? (
        <SubmitQuoteModal
          variants={priced.map((v) => ({
            id: v.id,
            label: v.label,
            fob: v.fob,
            status: v.status,
          }))}
          busy={busy}
          onClose={() => setSubmitOpen(false)}
          onSubmit={(ids) => {
            // No variants means a style-grained product: one plain submit.
            if (!priced.length) save("SUBMITTED");
            else submitAll(ids);
          }}
        />
      ) : null}

      {withdrawOpen ? (
        <div
          className="scrim app-scrim"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setWithdrawOpen(false);
          }}
        >
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="wd-title">
            <div className="modal-h">
              <div className="ttl" id="wd-title">Withdraw from this product</div>
              <button
                className="x"
                onClick={() => setWithdrawOpen(false)}
                aria-label="Close"
              >
                <Icon name="close" />
              </button>
            </div>
            <div className="modal-b">
              <WithdrawAction
                reinstate={bidStatus === "WITHDRAWN"}
                busy={busy}
                startArmed
                onCancel={() => setWithdrawOpen(false)}
                onConfirm={(reason) => {
                  setWithdrawOpen(false);
                  withdrawNow(reason);
                }}
              />
            </div>
          </div>
        </div>
      ) : null}

      {/* Quince's latest word, ONCE, as a dismissible message bar between
          the header and the tabs — not a card (Aravind C59, walkthrough
          8 Oct). View jumps to the conversation. */}
      {bid.data?.statusNote && !barDismissed ? (
        <div className={turnOf(bidStatus) === "VENDOR" ? "bar bar--warning vq-bar" : "bar bar--info vq-bar"}>
          <Icon name="chat" />
          <div>
            <strong>
              {turnOf(bidStatus) === "VENDOR" ? "Quince needs something from you." : "Quince's latest note."}
            </strong>{" "}
            {bid.data.statusNote}{" "}
            {tab !== "comments" ? (
              <button type="button" className="qd-link" onClick={() => setTab("comments")}>
                View comments
              </button>
            ) : null}
          </div>
          <button type="button" className="x" aria-label="Dismiss" onClick={() => setBarDismissed(true)}>
            <Icon name="close" />
          </button>
        </div>
      ) : null}

      {/* Two tabs, the same as Quince's side (decision D5; no Activity, D3). */}
      <div className="tabs vq-tabs" role="tablist" aria-label="This product">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "details"}
          className={tab === "details" ? "tab on" : "tab"}
          onClick={() => setTab("details")}
        >
          Bid details
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "comments"}
          className={tab === "comments" ? "tab on" : "tab"}
          onClick={() => setTab("comments")}
        >
          Comments{bid.data?.comments.length ? <span className="ct">{bid.data.comments.length}</span> : null}
        </button>
      </div>

      {tab === "comments" ? (
        <div className="card">
          <div className="card-b">
            <BidThread
              messages={bid.data?.comments ?? []}
              side="VENDOR"
              as="inline"
              busy={sending}
              onSend={sendMessage}
            />
          </div>
        </div>
      ) : (
      <>
      {data.rfp.instructions ? (
        <div className="bar bar--info" style={{ marginBlockEnd: "var(--space-lg)" }}>
          <Icon name="info_circle" />
          <div><strong>Instructions.</strong> {data.rfp.instructions}</div>
        </div>
      ) : null}

      <div className="quote-layout">
        <div>
          {/* THE TEMPLATE, LIGHT OR FULL.

              H2/H3: what changes across the lifecycle is HOW MUCH the vendor
              must fill, not how many bids exist. Light asks the 5 bucket
              totals; full adds the line items beneath them. Verified in the
              data: the buckets sum EXACTLY to FOB on real quotes, so the
              split needs no new arithmetic — the light template is the
              buckets and the full one is what drives them.

              Light keeps the line items present but COLLAPSED and never
              required, so a vendor who wants to show their working on round
              one can, and most will not bother. */}
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
                {isLight ? (
                  <>
                    {/* THE LIGHT TEMPLATE ASKS FOR THE TOTAL — J1.
                     
                        This used to render ONLY the folded line items, which
                        meant Materials and Crafting had no editable field at
                        all: both are derived, and `totalMaterialCost` is
                        itself a derived line. Akshay: "during the initial
                        quote, how is he entering just the total cost, not
                        the individual cost?" It was unusable, not untidy.
                     
                        domain/quote.ts now takes a typed total and lets the
                        line items override it once they produce a value. */}
                    <div className="quote-line qv-bucket">
                      <label
                        className="quote-line-label"
                        htmlFor={`bucket-${section.key}`}
                      >
                        {BUCKET_LABEL[section.key]} total
                        <span className="quote-line-help">
                          {overridden.includes(section.key)
                            ? "Your figure for this bucket"
                            : derivedBucket(section.key)
                              ? "From the line items below"
                              : "Enter a total for now — detail comes later"}
                        </span>
                      </label>
                      <div className="control quote-line-input">
                        <input
                          id={`bucket-${section.key}`}
                          type="number"
                          step="any"
                          min={0}
                          disabled={!canEdit || derivedBucket(section.key)}
                          value={
                            derivedBucket(section.key)
                              ? (computed.buckets[
                                  section.key as keyof typeof computed.buckets
                                ] ?? 0).toFixed(4)
                              : ((values[
                                  BUCKET_INPUT_KEY[section.key]
                                ] as string | number) ?? "")
                          }
                          onChange={(e) =>
                            setValues((prev) => ({
                              ...prev,
                              [BUCKET_INPUT_KEY[section.key]]:
                                e.target.value === ""
                                  ? ""
                                  : Number(e.target.value),
                            }))
                          }
                        />
                        <span className="affix">USD</span>
                      </div>
                    </div>

                    <details className="qv-detail">
                    <summary>
                      Show the {section.lines.filter((l) => !l.derived).length}{" "}
                      line items behind this
                      <span className="qv-detail-opt">optional</span>
                    </summary>
                    <div className="qv-detail-b">
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
                    </details>
                  </>
                ) : (
                  section.lines.map((line) => (
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
                  ))
                )}
              </div>
            </div>
          ))}

          {/* 5. DDP COST — the real Radnik template's own section.

              Six fees: three US destinations x two modes. Each total is
              FOB + that destination's fee for that mode, which is exactly
              what the template computes (`=E$65+E66`) — so the arithmetic
              is the template's, not ours.

              ONE block per product, not per variant: duty type is a term of
              trade for the whole product (Build Doc 3.6), and the route
              fans these across every variant row on save. */}
          <div className="card" style={{ marginBlockEnd: "var(--space-lg)" }}>
            <div className="card-h">
              <div className="ttl">DDP cost</div>
              <div className="sub">
                Optional — quote this only if you deliver duty-paid
              </div>
            </div>
            <div className="card-b">
              <label className="switch">
                <input
                  type="checkbox"
                  checked={ddpOn}
                  disabled={!canEdit}
                  onChange={(e) => setDdpToggle(e.target.checked)}
                />
                <span className="track" aria-hidden="true" />
                <span className="lbl">
                  I can deliver DDP into the US
                  <span className="quote-line-help">
                    Applies to this whole product, every variation
                  </span>
                </span>
              </label>

              {ddpOn ? (
                <div className="qv-ddp">
                  {(["SHIP", "AIR"] as const).map((mode) => (
                    <div className="qv-ddp-mode" key={mode}>
                      <div className="qv-ddp-h">
                        {mode === "SHIP" ? "Ocean" : "Air"}
                      </div>
                      {DDP_FEES.filter((f) => f.mode === mode).map((f) => {
                        const fee = numOrNull(ddpOf(f.key));
                        return (
                          <div className="quote-line" key={f.key}>
                            <label
                              className="quote-line-label"
                              htmlFor={`ddp-${f.key}`}
                            >
                              {f.label}
                              <span className="quote-line-help">
                                Additional charge into {f.hint}
                              </span>
                            </label>
                            <div className="control quote-line-input">
                              <input
                                id={`ddp-${f.key}`}
                                type="number"
                                step="any"
                                min={0}
                                disabled={!canEdit}
                                value={ddpOf(f.key)}
                                onChange={(e) =>
                                  setDdpEdits((prev) => ({
                                    ...prev,
                                    [f.key]: e.target.value,
                                  }))
                                }
                              />
                              <span className="affix">USD</span>
                            </div>
                            {/* The template's own total, shown so the vendor
                                sees what Quince will compare. */}
                            <output className="qv-ddp-total">
                              {fee === null || computed.fob === null
                                ? "—"
                                : unitCost(computed.fob + fee)}
                            </output>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                  <p className="quote-side-note">
                    Totals are your FOB plus each destination fee. Quince
                    compares your <strong>most expensive</strong> destination
                    in each mode, so a DDP quote wins only if it beats our own
                    freight everywhere.
                  </p>
                </div>
              ) : null}
            </div>
          </div>

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

              {/* NAME WHAT IS MISSING.
              
                  This used to read "5 inputs still needed" with no clue
                  WHICH, so a vendor facing a disabled Submit had nothing to
                  act on — Akshay: "why 5 inputs are still needed. why can't
                  I submit quote?" A count is not a reason. */}
              {missing.length ? (
                <div className="bar bar--warning" style={{ marginBlockStart: "var(--space-md)" }}>
                  <Icon name="alert_triangle" />
                  <div>
                    <strong>Still needed before you can submit:</strong>{" "}
                    {missing.map((k) => MISSING_LABEL[k] ?? k).join(", ")}.
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
            {/* H4 — the vendor never learns the RFP concept exists, so this
                is "your other products", not "products in this RFP". */}
            <div className="card-h"><div className="ttl">Your other products</div></div>
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
      )}
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
