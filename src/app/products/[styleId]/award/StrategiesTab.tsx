"use client";

import * as React from "react";
import { Icon } from "@/ds/components";
import { money, percent, unitCost } from "@/lib/format";
import { allocate } from "@/domain/award";
import {
  regionSplit,
  splitMatches,
  splitTotalsHundred,
  type SavedStrategy,
} from "@/domain/strategies";
import type { ProductBids } from "../types";

/**
 * Award strategies — four built-in rules, plus the ones you name and save.
 *
 * ## Built-in vs saved
 *
 * The four rules are DERIVED from the bids on every load, never stored, so a
 * new bid changes them — which is correct: "the three lowest existing vendors"
 * means whoever those are today. A saved strategy is the opposite: a snapshot
 * of a split you chose, so it comes back exactly as you left it.
 *
 * ## Why every number here is recomputed
 *
 * Nothing derived is persisted. A saved split is run through `allocate()` —
 * the same function the Allocate tab uses — so a card can never disagree with
 * the split it fills, and a figure refreshes if a vendor revises their bid.
 * This build has produced five bugs from two places computing one number.
 *
 * ## Why these are not the old "scenarios"
 *
 * `scenarios()` returned unit COSTS: "the mean of the three lowest bids" is a
 * price benchmark and cannot be applied, because a price is not a split. These
 * return splits, so the answer to "what does sourcing outside China cost" is
 * something you can read and then take.
 */
export function StrategiesTab({
  data,
  result,
  baseline,
  planUnits,
  currentSplit,
  saved,
  savedBusy,
  savedError,
  onApply,
  onSave,
  onDelete,
}: {
  data: ProductBids;
  result: ReturnType<typeof allocate> | null;
  baseline: number;
  planUnits: number;
  /** The inputs as a comparable split — drives the `current` chip. */
  currentSplit: Record<string, number>;
  saved: SavedStrategy[];
  savedBusy: boolean;
  savedError: string | null;
  onApply: (key: string, split: Record<string, number>) => void;
  onSave: (name: string, comment: string) => void;
  onDelete: (id: string) => void;
}) {
  const [saveOpen, setSaveOpen] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState<string | null>(null);

  /** Run a proposed split through the real allocator. */
  const evaluate = React.useCallback(
    (split: Record<string, number>) =>
      allocate({
        styleId: data.style.id,
        planUnits,
        baselineLanded: baseline,
        vendors: data.bids.map((b) => ({
          vendorId: b.vendorId,
          vendorName: b.vendorName,
          cooRegion: b.cooRegion,
          awardPct: split[b.vendorId] ?? 0,
          bestCost: b.bestCost,
          bestCostBasis: b.bestCostBasis,
          isNewToQuince: b.isNewToQuince,
        })),
      }),
    [data, planUnits, baseline],
  );

  const builtIn = data.strategies.map((s) => ({
    ...s,
    evaluated: s.unavailable ? null : evaluate(s.split),
  }));

  const savedCards = saved.map((s) => ({
    ...s,
    evaluated: evaluate(s.split),
  }));

  // The leader, among options that can actually be taken.
  const best = Math.max(
    0,
    ...[...builtIn, ...savedCards].map(
      (c) => c.evaluated?.totalSavingsDollars ?? 0,
    ),
  );

  /**
   * EXACTLY ONE card carries the `current` chip.
   *
   * Several can legitimately match: saving the non-China split creates a saved
   * strategy identical to the built-in rule that produced it, and both then
   * matched — two "current" badges, which tells the reader nothing about which
   * one they are looking at.
   *
   * A SAVED strategy wins. You named it deliberately; the built-in matching is
   * a coincidence of the numbers. Falls back to the first matching built-in,
   * then to "Your split" when nothing matches.
   */
  const currentId = React.useMemo(() => {
    const mine = savedCards.find((c) => splitMatches(c.split, currentSplit));
    if (mine) return mine.id;
    const rule = builtIn.find(
      (c) => !c.unavailable && splitMatches(c.split, currentSplit),
    );
    return rule?.key ?? null;
  }, [savedCards, builtIn, currentSplit]);

  const canSave = splitTotalsHundred(currentSplit);

  return (
    <div className="pd-strats">
      {/* The comparison baseline. Always first — every card is read against
          "what I have right now". */}
      <div className="pd-strat is-current">
        <div className="pd-strat-h">
          <div>
            <div className="pd-strat-n">Your split</div>
            <div className="pd-strat-r">Whatever is in the inputs now</div>
          </div>
          {!currentId && result?.isValid ? (
            <span className="pd-chip-current">current</span>
          ) : !result?.isValid ? (
            <span className="pd-strat-tag is-warn">
              {result && result.remainingPct > 0
                ? `${result.remainingPct}% unallocated`
                : "over 100%"}
            </span>
          ) : null}
        </div>

        <StratNumbers
          evaluated={result}
          bids={data.bids}
          isBest={!!result?.isValid && result.totalSavingsDollars >= best && best > 0}
        />

        {/* Naming the current split is what makes it comparable later. */}
        {saveOpen ? (
          <SaveForm
            busy={savedBusy}
            error={savedError}
            existing={saved.map((s) => s.name)}
            onCancel={() => setSaveOpen(false)}
            onSave={(name, note) => {
              onSave(name, note);
              setSaveOpen(false);
            }}
          />
        ) : (
          <button
            className="btn btn--ghost btn--sm"
            onClick={() => setSaveOpen(true)}
            disabled={!canSave}
            title={
              canSave
                ? "Name this split so you can come back to it"
                : "A strategy must total exactly 100% — it is a candidate for a real award"
            }
          >
            <Icon name="plus" size="sm" />
            Save as a strategy
          </button>
        )}
      </div>

      {builtIn.map((c) => (
        <div
          className={c.unavailable ? "pd-strat is-off" : "pd-strat"}
          key={c.key}
        >
          <div className="pd-strat-h">
            <div>
              <div className="pd-strat-n">{c.label}</div>
              <div className="pd-strat-r">{c.rule}</div>
            </div>
            {c.unavailable ? null : currentId === c.key ? (
              <span className="pd-chip-current">current</span>
            ) : (
              <button
                className="btn btn--ghost btn--sm"
                onClick={() => onApply(c.key, c.split)}
              >
                Apply
              </button>
            )}
          </div>

          {/* A rule that cannot be built says WHY rather than vanishing —
              "no vendor outside China bid this" is itself a finding. */}
          {c.unavailable ? (
            <p className="pd-strat-off">
              <Icon name="info_circle" size="sm" />
              {c.unavailable}
            </p>
          ) : (
            <StratNumbers
              evaluated={c.evaluated}
              bids={data.bids}
              isBest={(c.evaluated?.totalSavingsDollars ?? 0) >= best && best > 0}
            />
          )}
        </div>
      ))}

      {savedCards.map((c) => (
        <div
          className={
            currentId === c.id
              ? "pd-strat is-saved is-applied"
              : "pd-strat is-saved"
          }
          key={c.id}
        >
          <div className="pd-strat-h">
            <div>
              <div className="pd-strat-n">
                {c.name}
                <span className="pd-strat-mine">saved</span>
              </div>
              {c.comment ? (
                <div className="pd-strat-note">{c.comment}</div>
              ) : (
                <div className="pd-strat-r">No note</div>
              )}
            </div>

            {currentId === c.id ? (
              <span className="pd-chip-current">current</span>
            ) : (
              <button
                className="btn btn--ghost btn--sm"
                onClick={() => onApply(c.id, c.split)}
              >
                Apply
              </button>
            )}
          </div>

          <StratNumbers
            evaluated={c.evaluated}
            bids={data.bids}
            isBest={c.evaluated.totalSavingsDollars >= best && best > 0}
          />

          {/* Inline confirm, no modal — the question appears where the click
              landed, the same idiom as the Award confirmation in the footer. */}
          {confirmDelete === c.id ? (
            <div className="pd-strat-del">
              <span>Delete this strategy?</span>
              <button
                className="btn btn--ghost btn--sm"
                onClick={() => setConfirmDelete(null)}
                disabled={savedBusy}
              >
                No
              </button>
              {/* Ghost for the same reason as the save form: the footer owns
                  the page's secondary. The danger foreground plus being last
                  is what marks it, per the menu rule. */}
              <button
                className="btn btn--ghost btn--sm pd-del-yes"
                onClick={() => {
                  onDelete(c.id);
                  setConfirmDelete(null);
                }}
                disabled={savedBusy}
              >
                Yes, delete
              </button>
            </div>
          ) : (
            <button
              className="btn btn--ghost btn--sm pd-strat-delbtn"
              onClick={() => setConfirmDelete(c.id)}
            >
              Delete
            </button>
          )}
        </div>
      ))}

      {savedError && !saveOpen ? (
        <div className="bar bar--danger pd-strats-err">
          <Icon name="alert_triangle" />
          <div>{savedError}</div>
        </div>
      ) : null}

      <p className="pd-strats-note">
        Every figure is computed by the same allocator the Allocate tab uses, so
        a card and the split it fills always agree. Applying one fills the
        inputs — it does not save. Deleting a strategy never changes the
        allocation.
      </p>
    </div>
  );
}

/** Name + note for the current split. */
function SaveForm({
  busy,
  error,
  existing,
  onCancel,
  onSave,
}: {
  busy: boolean;
  error: string | null;
  existing: string[];
  onCancel: () => void;
  onSave: (name: string, comment: string) => void;
}) {
  const [name, setName] = React.useState("");
  const [note, setNote] = React.useState("");

  // Caught here as well as in the route, so the user is told before a round
  // trip rather than after.
  const clash = existing.some(
    (e) => e.trim().toLowerCase() === name.trim().toLowerCase(),
  );

  return (
    <div className="pd-strat-form">
      <div className="field">
        <label className="lbl" htmlFor="strat-name">
          Strategy name
        </label>
        <div className="control sm">
          <input
            id="strat-name"
            value={name}
            placeholder="Q3 dual-source"
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>
      </div>

      <div className="field">
        <label className="lbl" htmlFor="strat-note">
          Note
          <span className="hint"> — optional</span>
        </label>
        <div className="control textarea">
          <textarea
            id="strat-note"
            rows={2}
            value={note}
            placeholder="Why this split is worth keeping."
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      </div>

      {clash ? (
        <p className="pd-strat-warn">
          <Icon name="alert_triangle" size="sm" />
          A strategy with that name already exists here.
        </p>
      ) : null}

      {error ? (
        <p className="pd-strat-warn">
          <Icon name="alert_triangle" size="sm" />
          {error}
        </p>
      ) : null}

      <div className="pd-strat-formacts">
        <button className="btn btn--ghost btn--sm" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        {/* GHOST, not secondary. The page already has a secondary — "Ready
            for review" in the pinned footer — and the system counts what is
            ON SCREEN, not what belongs to which component. A second secondary
            competes with the page's real runner-up. */}
        <button
          className="btn btn--ghost btn--sm"
          disabled={busy || !name.trim() || clash}
          onClick={() => onSave(name.trim(), note.trim())}
        >
          {busy ? "Saving…" : "Save strategy"}
        </button>
      </div>
    </div>
  );
}

function StratNumbers({
  evaluated,
  bids,
  isBest,
}: {
  evaluated: ReturnType<typeof allocate> | null;
  bids: ProductBids["bids"];
  isBest: boolean;
}) {
  if (!evaluated) return null;

  const on = evaluated.lines.filter((l) => l.awardPct > 0);
  const regions = regionSplit(
    evaluated.lines,
    bids.map((b) => b.cooRegion),
  ).filter((r) => r.dollars > 0);

  return (
    <>
      <div className="pd-strat-nums">
        <div className="pd-strat-sav">
          <span className={evaluated.totalSavingsDollars >= 0 ? "pos" : "neg"}>
            {money(evaluated.totalSavingsDollars)}
          </span>
          {isBest ? <span className="pd-strat-best">best</span> : null}
          <span className="pd-strat-k">
            {percent(evaluated.savingsPercent)} vs baseline
          </span>
        </div>
        <div className="pd-strat-blend">
          <span>{unitCost(evaluated.blendedCost)}</span>
          <span className="pd-strat-k">blended unit cost</span>
        </div>
      </div>

      {/* The split itself, so a card is checkable rather than a claim. */}
      <div className="pd-strat-split">
        {on.map((l) => (
          <span className="pd-chip" key={l.vendorId}>
            <strong>{l.awardPct}%</strong> {l.vendorName}
          </span>
        ))}
      </div>

      <div className="pd-strat-regions">
        {regions.map((r) => (
          <span className="pd-strat-reg" key={r.region}>
            {r.region} {percent(r.share, 0)}
          </span>
        ))}
      </div>
    </>
  );
}
