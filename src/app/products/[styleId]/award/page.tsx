"use client";

import * as React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@/ds/components";
import { useApi } from "@/lib/useApi";
import { money, percent, unitCost, units } from "@/lib/format";
import { allocate } from "@/domain/award";
import {
  regionSplit,
  splitFromInputs,
  type SavedStrategy,
} from "@/domain/strategies";
import { ProductHeader } from "../ProductHeader";
import { StyleDetail } from "@/app/style-sets/StyleDetail";
import { type ProductBids } from "../types";
import { AllocateTab } from "./AllocateTab";
import { StrategiesTab } from "./StrategiesTab";
import { CompareBidsTab } from "./CompareBidsTab";

/**
 * A5 — AWARD ALLOCATION, as a full page.
 *
 * Replaces the Playground drawer. The drawer stacked allocate -> readout ->
 * breakdown -> scenarios -> guardrails vertically inside 640px, so changing a
 * percentage meant scrolling away from the number it moved, and the Award
 * confirmation rendered so far down the scroll that clicking Award looked like
 * nothing happening.
 *
 * TABS, so each job gets the width it needs and the footer stays put. The
 * footer is the commit surface and it is PINNED — the confirmation replaces its
 * action row, so the question appears exactly where the click landed.
 *
 * THERE IS NO GUARDRAILS TAB, deliberately. A per-product cap was never
 * coherent: China's 30% ceiling is a property of the WAVE and one product is a
 * single contributor to it. This page shows the region split as INFORMATION —
 * no cap, no range, no breach — and Wave Insights keeps the real guardrails.
 */

/**
 * ONE tab row. There used to be two — a header row
 * (`Compare bids | Award allocation`) over a sub-row
 * (`Allocate | Strategies | Cost breakdown`) — where the header's second tab
 * named the page you were already on and "Cost breakdown" was a strict subset
 * of the bid matrix behind the first. Now: compare, then decide, then compare
 * your own options.
 */
type Tab = "compare" | "allocate" | "strategies";

function ProductAwardInner() {
  const params = useParams<{ styleId: string }>();
  const router = useRouter();
  const styleId = params.styleId;
  const { data, loading, error, reload } = useApi<ProductBids>(
    styleId ? `/api/styles/${styleId}/bids` : null,
  );

  /**
   * Lands on ALLOCATE even though Compare bids is first in the row: arriving
   * from Award Summary means you picked this product to allocate, and the
   * pinned footer carries the commit. Compare bids is one click away.
   */
  const [tab, setTab] = React.useState<Tab>("allocate");

  /**
   * The style drawer holds the real gallery — every image at full size plus
   * colourways. The header keeps one fixed thumbnail so its height does not
   * depend on how many images a product happens to have.
   *
   * `StyleDetail` is reused as-is: it fetches its own data from a styleId, and
   * it is a single modal surface at --z-modal (3000), so it paints above the
   * pinned footer (--z-sticky, 100) and does not nest a SideDrawer inside
   * another (T11).
   */
  const [galleryOpen, setGalleryOpen] = React.useState(false);

  /**
   * Where the breadcrumb goes back to.
   *
   * Award Summary keeps its filters in the URL and passes that querystring
   * through as `?back=`, so returning restores all seven filters and the view
   * toggle. Without it, clicking a product silently dropped the lot.
   */
  const search = useSearchParams();
  const backQuery = search.get("back") ?? "";
  const backHref = backQuery ? `/award?${backQuery}` : "/award";
  const backLabel = React.useMemo(() => {
    if (!backQuery) return "Award summary";
    const applied = new URLSearchParams(backQuery);
    applied.delete("view");
    const n = [...applied.keys()].filter((k) => applied.get(k)).length;
    return n ? `Award summary · ${n} filter${n === 1 ? "" : "s"}` : "Award summary";
  }, [backQuery]);

  /**
   * Award % AS TYPED, keyed by vendor, holding only what the user changed.
   *
   * Edits layered over saved state rather than an effect that rebuilds one map
   * from the server — the pattern that fixed the same data-loss bug three times
   * now (Playground, quote form, RFP nomination). A reload refreshes the saved
   * half and leaves the edits alone.
   */
  const [edits, setEdits] = React.useState<Record<string, string>>({});
  const [commentEdit, setCommentEdit] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [confirmAward, setConfirmAward] = React.useState(false);
  const [applied, setApplied] = React.useState<string | null>(null);

  /**
   * Named strategies saved on this product.
   *
   * Their own fetch rather than a field on the bids payload: saving one should
   * not refetch every bid, every bucket split and the clean sheet.
   */
  const savedApi = useApi<SavedStrategy[]>(
    styleId ? `/api/styles/${styleId}/strategies` : null,
  );
  // Memoised: `?? []` builds a new array every render, which would defeat the
  // memo below and recompute the applied label on every keystroke.
  const savedStrategies = React.useMemo(
    () => savedApi.data ?? [],
    [savedApi.data],
  );
  const [savedBusy, setSavedBusy] = React.useState(false);
  const [savedError, setSavedError] = React.useState<string | null>(null);

  const saved = React.useMemo(() => {
    const map: Record<string, string> = {};
    for (const a of data?.allocation ?? []) {
      if (a.awardPct > 0) map[a.vendorId] = String(a.awardPct);
    }
    return map;
  }, [data]);

  // Memoised deliberately: a fresh object every render defeats the `result`
  // memo below, and this recomputes on every keystroke.
  const pct = React.useMemo(() => ({ ...saved, ...edits }), [saved, edits]);

  const comment =
    commentEdit ??
    data?.allocation.find((a) => a.comment)?.comment ??
    "";

  const baseline =
    data?.style.baselineLanded ?? data?.style.baselineFob ?? 0;
  const planUnits = data?.style.planUnits ?? 0;

  const result = React.useMemo(() => {
    if (!data) return null;
    return allocate({
      styleId: data.style.id,
      planUnits,
      baselineLanded: baseline,
      vendors: data.bids.map((b) => ({
        vendorId: b.vendorId,
        vendorName: b.vendorName,
        cooRegion: b.cooRegion,
        awardPct: Number(pct[b.vendorId] ?? 0) || 0,
        bestCost: b.bestCost,
        bestCostBasis: b.bestCostBasis,
        isNewToQuince: b.isNewToQuince,
      })),
    });
  }, [data, pct, baseline, planUnits]);

  /** Informational only — see the note at the top of this file. */
  const regions = React.useMemo(() => {
    if (!data || !result) return [];
    return regionSplit(
      result.lines,
      data.bids.map((b) => b.cooRegion),
    );
  }, [data, result]);

  /**
   * The inputs as a comparable split. Drives the `current` chip, which has to
   * work for a built-in rule AND a saved strategy — the chip means "you are
   * looking at this one" and the kind does not matter.
   */
  const currentSplit = React.useMemo(() => splitFromInputs(pct), [pct]);

  /** Label of whatever filled the inputs, built-in or saved. */
  const appliedLabel = React.useMemo(() => {
    if (!applied) return null;
    return (
      data?.strategies.find((x) => x.key === applied)?.label ??
      savedStrategies.find((x) => x.id === applied)?.name ??
      null
    );
  }, [applied, data, savedStrategies]);

  async function saveStrategy(name: string, note: string) {
    if (!data) return;
    setSavedBusy(true);
    setSavedError(null);
    try {
      const response = await fetch(
        `/api/styles/${data.style.id}/strategies`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name,
            comment: note || null,
            split: currentSplit,
          }),
        },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body?.message ?? "Could not save");
      savedApi.reload();
      // The newly saved strategy IS what is in the inputs, so it becomes the
      // applied one — otherwise the card you just created reads as inactive.
      setApplied(body.id);
    } catch (err: unknown) {
      setSavedError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavedBusy(false);
    }
  }

  async function deleteStrategy(id: string) {
    if (!data) return;
    setSavedBusy(true);
    setSavedError(null);
    try {
      const response = await fetch(
        `/api/styles/${data.style.id}/strategies/${id}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body?.message ?? "Could not delete");
      }
      // Deleting never touches the allocation — a strategy is a candidate, and
      // Award owns what was committed. So the inputs stay exactly as they are;
      // only the provenance label is cleared.
      if (applied === id) setApplied(null);
      savedApi.reload();
    } catch (err: unknown) {
      setSavedError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavedBusy(false);
    }
  }

  function setPct(vendorId: string, value: string) {
    setApplied(null);
    setEdits((prev) => ({ ...prev, [vendorId]: value }));
  }

  /**
   * Fill the inputs from a strategy. An explicit act, never automatic — the
   * rule was "nothing moves a value the user did not type", and this makes it
   * "nothing moves a value the user did not ASK for". Every input stays
   * editable afterwards.
   */
  function applyStrategy(key: string, split: Record<string, number>) {
    if (!data) return;
    const next: Record<string, string> = {};
    // EVERY vendor, not just the ones in the split — a vendor left out must go
    // to 0, or the previous split's percentages survive underneath and the
    // total silently exceeds 100.
    for (const b of data.bids) {
      next[b.vendorId] = String(split[b.vendorId] ?? 0);
    }
    setEdits(next);
    setApplied(key);
    setTab("allocate");
  }

  async function save(status: "ALLOCATED" | "READY_FOR_REVIEW" | "AWARDED") {
    if (!data || !result?.isValid) return;
    setSaving(true);
    setSaveError(null);
    try {
      const response = await fetch(`/api/styles/${data.style.id}/award`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          // The complete split every time: the route replaces all rows for the
          // style rather than merging, so a partial payload would delete the
          // vendors it omits.
          allocations: data.bids
            .map((b) => ({
              vendorId: b.vendorId,
              awardPct: Number(pct[b.vendorId] ?? 0) || 0,
            }))
            .filter((a) => a.awardPct > 0),
          comment: comment.trim() || null,
          status,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.message ?? "Could not save");
      setEdits({});
      setCommentEdit(null);
      setConfirmAward(false);
      if (status === "AWARDED") router.push(backHref);
      else reload();
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="pd-page">
        <div className="sk" style={{ blockSize: 160, marginBlockEnd: 24 }} />
        <div className="sk" style={{ blockSize: 320 }} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="pd-page">
        <div className="bar bar--danger">
          <Icon name="alert_triangle" />
          <div>
            <strong>Could not load this product.</strong> {error}
          </div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const status = data.allocation[0]?.status ?? null;
  const isAwarded = status === "AWARDED";

  return (
    <div className="pd-page has-pinned">
      {/*
        STICKY: identity + facts + tabs are one unit that pins to the top of
        the scroll container (`.shell > .ct`, measured overflow-y: auto — NOT
        the document, which does not scroll here).

        Akshay's ask: "clip the headers ... and the rest of the scroll applies
        in Compare bids, Allocate, Strategies." So you always know which
        product you are on and can switch tabs without scrolling back up.
      */}
      <div className="pd-sticky">
        <ProductHeader
          data={data}
          bidCount={data.bids.length}
          backHref={backHref}
          backLabel={backLabel}
          onOpenGallery={() => setGalleryOpen(true)}
        />

        <div className="tabs pd-subtabs" role="tablist" aria-label="Product view">
          {/* Compare bids leads — look, then decide. */}
          <button
            className={tab === "compare" ? "tab on" : "tab"}
            role="tab"
            aria-selected={tab === "compare"}
            onClick={() => setTab("compare")}
          >
            Compare bids
            <span className="ct">{data.bids.length}</span>
          </button>
          <button
            className={tab === "allocate" ? "tab on" : "tab"}
            role="tab"
            aria-selected={tab === "allocate"}
            onClick={() => setTab("allocate")}
          >
            Allocate
          </button>
          <button
            className={tab === "strategies" ? "tab on" : "tab"}
            role="tab"
            aria-selected={tab === "strategies"}
            onClick={() => setTab("strategies")}
          >
            Strategies
            <span className="ct">
              {data.strategies.filter((s) => !s.unavailable).length +
                savedStrategies.length}
            </span>
          </button>
        </div>
      </div>

      {data.bids.length === 0 ? (
        <div className="empty">
          <span className="glyph">
            <Icon name="invoice" size="lg" />
          </span>
          <div className="ttl">Nothing to allocate</div>
          <div className="desc">
            No vendor has submitted a bid on this product yet.
          </div>
        </div>
      ) : (
        <>
          {isAwarded ? (
            <div className="bar bar--info aw-awarded-bar">
              <Icon name="check" />
              <div>
                <strong>This product is awarded.</strong> Vendors have been
                told the outcome. Changing the split now means telling them
                again.
              </div>
            </div>
          ) : null}

          {tab === "compare" ? <CompareBidsTab data={data} /> : null}

          {tab === "allocate" ? (
            <AllocateTab
              data={data}
              pct={pct}
              result={result}
              regions={regions}
              baseline={baseline}
              planUnits={planUnits}
              applied={appliedLabel}
              comment={comment}
              onPct={setPct}
              onComment={setCommentEdit}
            />
          ) : null}

          {tab === "strategies" ? (
            <StrategiesTab
              data={data}
              result={result}
              baseline={baseline}
              planUnits={planUnits}
              currentSplit={currentSplit}
              saved={savedStrategies}
              savedBusy={savedBusy}
              savedError={savedError}
              onApply={applyStrategy}
              onSave={saveStrategy}
              onDelete={deleteStrategy}
            />
          ) : null}

          {saveError ? (
            <div className="bar bar--danger" style={{ marginBlockStart: "var(--space-md)" }}>
              <Icon name="alert_triangle" />
              <div>{saveError}</div>
            </div>
          ) : null}

          {/*
            PINNED, and the confirmation replaces the action row rather than
            appearing below it. In the drawer the confirm bar rendered as the
            last child of a long scrollable body — measured out of the viewport
            — so clicking Award looked like nothing happening. The question now
            appears exactly where the click landed.
          */}
          <div className="pd-footer">
            {confirmAward ? (
              <>
                <div className="pd-footer-state pd-confirm-q">
                  <Icon name="alert_triangle" size="sm" />
                  <span>
                    <strong>Award this product?</strong> Winners and losers are
                    both told.
                  </span>
                </div>
                <button
                  className="btn btn--ghost"
                  onClick={() => setConfirmAward(false)}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  className="btn btn--primary"
                  onClick={() => save("AWARDED")}
                  disabled={saving}
                >
                  {saving ? "Awarding…" : "Yes, award it"}
                </button>
              </>
            ) : (
              <>
                <div className="pd-footer-state">
                  {result?.isValid ? (
                    <span className="pd-valid">
                      <Icon name="check" size="sm" />
                      100% allocated
                    </span>
                  ) : (
                    <span className="pd-invalid">
                      {result && result.remainingPct > 0
                        ? `${result.remainingPct}% still to allocate`
                        : `${result ? Math.abs(result.remainingPct) : 0}% over`}
                    </span>
                  )}
                  {result?.isValid ? (
                    <span className="pd-footer-sav">
                      {/* No leading separator here — `.pd-footer-sav::before`
                          draws it, so writing one too gave a double gap. */}
                      saves {money(result.totalSavingsDollars)} ·{" "}
                      {percent(result.savingsPercent)}
                    </span>
                  ) : null}
                </div>

                <button
                  className="btn btn--ghost"
                  onClick={() => save("ALLOCATED")}
                  disabled={!result?.isValid || saving}
                >
                  {saving ? "Saving…" : "Save allocation"}
                </button>
                {/* The middle state of §11.10's allocate -> review -> award. */}
                <button
                  className="btn btn--secondary"
                  onClick={() => save("READY_FOR_REVIEW")}
                  disabled={!result?.isValid || saving}
                  title="Hand this split to the reviewer. Vendors are told nothing yet."
                >
                  Ready for review
                </button>
                {/* Awarding is the RELEASE — it is what tells vendors, winners
                    and losers both. Separate from Save because an allocation is
                    still a working decision. */}
                <button
                  className="btn btn--primary"
                  onClick={() => setConfirmAward(true)}
                  disabled={!result?.isValid || saving}
                >
                  Award
                </button>
              </>
            )}
          </div>
        </>
      )}

      {/* The real gallery. Reused as-is from the style-set browser — it fetches
          its own data, so the header only needs to hand it a styleId. */}
      <StyleDetail
        styleId={galleryOpen ? data.style.id : null}
        onClose={() => setGalleryOpen(false)}
      />
    </div>
  );
}

/** Shared by the tabs — one definition so the readout cannot drift. */
export function Readout({
  result,
  baseline,
  planUnits,
}: {
  result: ReturnType<typeof allocate> | null;
  baseline: number;
  planUnits: number;
}) {
  if (!result) return null;
  return (
    <dl className="pd-readout">
      <div className="pd-ro">
        <dt>Savings at this split</dt>
        <dd className={result.totalSavingsDollars >= 0 ? "pos" : "neg"}>
          {money(result.totalSavingsDollars)}
        </dd>
        <dd className="s">{percent(result.savingsPercent)} vs baseline</dd>
      </div>
      <div className="pd-ro">
        <dt>Blended cost</dt>
        <dd>{unitCost(result.blendedCost)}</dd>
        <dd className="s">baseline {unitCost(baseline)}</dd>
      </div>
      <div className="pd-ro">
        <dt>Awarded value</dt>
        <dd>{money(result.totalAwardedDollars)}</dd>
        <dd className="s">{units(planUnits)} units/yr</dd>
      </div>
      <div className="pd-ro">
        <dt>Allocated</dt>
        <dd className={result.isValid ? "pos" : undefined}>
          {result.allocatedPct}%
        </dd>
        <dd className="s">
          {result.isValid ? "ready to save" : "must total 100%"}
        </dd>
      </div>
    </dl>
  );
}

/**
 * `useSearchParams()` opts this route out of static prerendering, and Next
 * requires a Suspense boundary to say what to show while the URL is unknown.
 * Without it `next build` fails on this page — which `next dev` never
 * reveals, because dev does not prerender.
 */
export default function Page() {
  return (
    <React.Suspense fallback={<div className="pd-page"><div className="sk" style={{ blockSize: 160, marginBlockEnd: 24 }} /><div className="sk" style={{ blockSize: 320 }} /></div>}>
      <ProductAwardInner />
    </React.Suspense>
  );
}
