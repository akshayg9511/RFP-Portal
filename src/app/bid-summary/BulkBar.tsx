"use client";

import * as React from "react";
import { Icon } from "@/ds/components";
import { SelBarMenu } from "@/components/SelBarMenu";
import { quinceLabel, transitionsFrom, type BidStatus } from "@/domain/bidStatus";
import type { FlatRow } from "./types";

/**
 * BULK — decision P10, 5 Oct.
 *
 * Tick rows, then move them all with ONE note. Only the moves legal for
 * EVERY ticked bid are offered — the same rule as bulk grain change in
 * Variation setup — so a mixed selection can never be pushed somewhere one
 * of its bids cannot go.
 *
 * Status lives on vendor x PRODUCT (H1), not per variant, so the ticked rows
 * are collapsed to distinct (invitation, product) pairs first: ticking all
 * five sizes of one vendor's bid is one move, not five.
 *
 * The DS rule for bulk actions: one ghost menu in the selection bar.
 */
export function BulkBar({
  rows,
  onClear,
  onDone,
}: {
  rows: FlatRow[];
  onClear: () => void;
  onDone: () => void;
}) {
  const [moveTo, setMoveTo] = React.useState<BidStatus | null>(null);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Distinct vendor x product pairs — where status actually lives.
  const pairs = React.useMemo(() => {
    const m = new Map<string, { invitationId: string; styleId: string; status: BidStatus }>();
    for (const r of rows) {
      m.set(`${r.invitationId}|${r.group.styleId}`, {
        invitationId: r.invitationId,
        styleId: r.group.styleId,
        status: r.stage.status as BidStatus,
      });
    }
    return [...m.values()];
  }, [rows]);

  // The intersection of Quince's legal moves across every pair.
  const legal = React.useMemo(() => {
    if (!pairs.length) return [];
    const sets = pairs.map((p) => new Set(transitionsFrom(p.status, "QUINCE").map((t) => t.to)));
    return [...sets[0]!].filter((to) => sets.every((s) => s.has(to)));
  }, [pairs]);

  // Reserve room for the bar on the scroll container, as the tray does.
  React.useEffect(() => {
    if (!rows.length) return;
    const scroller = document.querySelector(".shell > .ct");
    scroller?.classList.add("has-tray");
    return () => scroller?.classList.remove("has-tray");
  }, [rows.length]);

  async function apply() {
    if (!moveTo || !note.trim()) return;
    setBusy(true);
    setError(null);
    const failed: string[] = [];
    // Sequential: each move posts into its own thread, and the server
    // validates every one against the ladder independently.
    for (const p of pairs) {
      const r = await fetch(`/api/bids/${p.invitationId}/${p.styleId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to: moveTo, note: note.trim(), authorSide: "QUINCE" }),
      });
      if (!r.ok) failed.push(p.invitationId);
    }
    setBusy(false);
    if (failed.length) {
      setError(`${failed.length} of ${pairs.length} could not be moved.`);
      onDone();
      return;
    }
    setMoveTo(null);
    setNote("");
    onDone();
    onClear();
  }

  if (!rows.length) return null;

  return (
    <>
      <div className="sel-bar fixed">
        <span className="cnt">
          {rows.length} bid{rows.length === 1 ? "" : "s"}
          {pairs.length !== rows.length
            ? ` · ${pairs.length} vendor × style${pairs.length === 1 ? "" : "s"}`
            : ""}
        </span>
        {/* Reworked selection bar (Aravind, C29): Clear selection, then ONE
            menu with only the moves legal for every selected bid. */}
        <div className="acts">
          <button className="btn btn--ghost" onClick={onClear}>Clear selection</button>
          <SelBarMenu
            label="Move"
            items={
              legal.length
                ? legal.map((to) => ({ label: `Move to ${quinceLabel(to)}`, onSelect: () => setMoveTo(to) }))
                : [{ label: "No move fits every selected bid", disabled: true, onSelect: () => {} }]
            }
          />
        </div>
      </div>

      {moveTo ? (
        <div
          className="scrim app-scrim"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !busy) setMoveTo(null);
          }}
        >
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="bulk-title">
            <div className="modal-h">
              <div className="ttl" id="bulk-title">
                Move {pairs.length} bid{pairs.length === 1 ? "" : "s"} to {quinceLabel(moveTo)}
              </div>
              <button className="x" onClick={() => setMoveTo(null)} aria-label="Close" disabled={busy}>
                <Icon name="close" />
              </button>
            </div>
            <div className="modal-b">
              <label className="bl-act-l" htmlFor="bulk-note">
                One note, sent to every vendor — this is what they read
              </label>
              <div className="control textarea">
                <textarea
                  id="bulk-note"
                  rows={3}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
              {error ? <p className="bd-err">{error}</p> : null}
            </div>
            <div className="modal-f">
              {/* Every modal has a way out (Aravind, C9/C65). */}
              <button className="btn btn--secondary" disabled={busy} onClick={() => setMoveTo(null)}>
                Cancel
              </button>
              <button className="btn btn--primary" disabled={busy || !note.trim()} onClick={apply}>
                {busy ? "Moving…" : `Move ${pairs.length}`}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
