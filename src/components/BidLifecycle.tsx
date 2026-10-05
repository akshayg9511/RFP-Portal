"use client";

import * as React from "react";
import { Badge, Icon } from "@/ds/components";
import { useApi } from "@/lib/useApi";
import { BidThread, type ThreadMessage } from "@/components/BidThread";
import {
  STRIP,
  detailFor,
  hintFor,
  stripPosition,
  turnLabel,
  turnOf,
  vendorStatus,
  vendorStripLabel,
  type BidStatus,
} from "@/domain/bidStatus";

/**
 * Where a bid stands, and the one action its owner can take.
 *
 * REBUILT 5 Oct from Akshay's review. The previous version put the status,
 * the strip, the move control AND the whole conversation in one inline
 * panel, which he called "very, very clumsy" — correctly. Three changes:
 *
 *  J5 · WHOSE TURN IS ITS OWN SLOT. "Full costing submitted — with Quince"
 *       was a sentence doing three jobs. Now: a short status, a "Your turn"
 *       / "With Quince" marker, and a one-line hint.
 *  J6 · A PERMANENT HINT plus an ⓘ for the longer explanation, both on the
 *       status rather than in the page header.
 *  J3 · THE CHAT MOVES OUT, behind a Comments button. This panel is state
 *       and actions; BidThread is the conversation.
 */

type BidView = {
  status: BidStatus;
  quinceLabel: string;
  vendorLabel: string;
  statusNote: string | null;
  transitions: { to: BidStatus; label: string; vendorWillSee: string }[];
  comments: ThreadMessage[];
};

export function BidLifecycle({
  invitationId,
  styleId,
  side = "QUINCE",
  authorName,
  /**
   * "panel" when this sits inside another drawer — SideDrawer cannot nest
   * (T11), and the Quince side opens from within the bid drawer.
   */
  threadAs = "drawer",
}: {
  invitationId: string;
  styleId: string;
  side?: "QUINCE" | "VENDOR";
  authorName?: string | null;
  threadAs?: "drawer" | "panel";
}) {
  const { data, loading, reload } = useApi<BidView>(
    `/api/bids/${invitationId}/${styleId}?side=${side}`,
  );

  const [moveTo, setMoveTo] = React.useState<BidStatus | "">("");
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [threadOpen, setThreadOpen] = React.useState(false);
  const [detailOpen, setDetailOpen] = React.useState(false);

  async function send(payload: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/bids/${invitationId}/${styleId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ authorSide: side, authorName, ...payload }),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b?.message ?? "Could not update");
      setNote("");
      setMoveTo("");
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update");
    } finally {
      setBusy(false);
    }
  }

  if (loading && !data) return <div className="sk" style={{ blockSize: 120 }} />;
  if (!data) return null;

  const here = stripPosition(data.status);
  const turn = turnOf(data.status);
  const chosen = data.transitions.find((t) => t.to === moveTo);

  /**
   * The vendor's one exit is WITHDRAW, and Quince's is NOT PROCEEDING —
   * named for who owns each (Akshay, 5 Oct). So the vendor's exit is lifted
   * OUT of the generic picker into its own labelled action: they should not
   * have to read a dropdown to discover they can stop.
   */
  const withdraw = data.transitions.find((t) => t.to === "WITHDRAWN");
  const reinstate = data.status === "WITHDRAWN";
  const moves = data.transitions.filter((t) => t.to !== "WITHDRAWN");

  return (
    <div className="bl">
      {/* STATE — the three facts, in three slots. */}
      <div className="bl-state">
        <span className={`bl-turn is-${turn.toLowerCase()}`}>
          <span className="bl-turn-dot" aria-hidden="true" />
          {turnLabel(data.status)}
        </span>

        {/* The SHORT status (J5). The marker beside it already says whose
            turn it is, so `vendorLabel` here repeated it — "WITH QUINCE ·
            Full costing submitted — with Quince". `vendorLabel` keeps its
            job on the product LIST, where one column has to say both. */}
        <Badge tone={data.status === "NOT_PROCEEDING" ? "danger" : undefined}>
          {side === "QUINCE" ? data.quinceLabel : vendorStatus(data.status)}
        </Badge>

        {/* J10 — opens on HOVER and on FOCUS. Hover because Akshay asked
            for it; focus because a hover-only affordance is unreachable by
            keyboard, and the detail is the only place the lifecycle is
            explained. Click still toggles, so it works on touch. */}
        <span
          className="bl-info-wrap"
          onMouseEnter={() => setDetailOpen(true)}
          onMouseLeave={() => setDetailOpen(false)}
        >
          <button
            type="button"
            className="bl-info"
            aria-expanded={detailOpen}
            aria-label="What this status means"
            onFocus={() => setDetailOpen(true)}
            onBlur={() => setDetailOpen(false)}
            onClick={() => setDetailOpen((v) => !v)}
          >
            <Icon name="info_circle" size="sm" />
          </button>
        </span>

        <button
          type="button"
          className="btn btn--ghost btn--sm bl-comments"
          onClick={() => setThreadOpen(true)}
        >
          <Icon name="chat" size="sm" />
          Comments{data.comments.length ? ` ${data.comments.length}` : ""}
        </button>
      </div>

      {/* The permanent one-liner (J6) — no hover needed to know what is wanted. */}
      <p className="bl-hint">
        {side === "VENDOR" ? (
          hintFor(data.status)
        ) : (
          <>
            The vendor sees <strong>{data.vendorLabel}</strong>
          </>
        )}
      </p>

      {detailOpen ? (
        <div className="bl-detail">{detailFor(data.status)}</div>
      ) : null}

      {/* The last thing said with a status change, so the current state has
          its reason attached without opening the conversation. */}
      {data.statusNote ? (
        <p className="bl-note">
          <Icon name="chat" size="sm" />
          {data.statusNote}
        </p>
      ) : null}

      {/* THE STRIP — the shape of the process (H1), after the state, because
          where you are matters more than the map. */}
      <ol className="bl-strip">
        {STRIP.map((s, i) => (
          <li
            key={s}
            className={`bl-step${i === here ? " on" : ""}${i < here ? " done" : ""}`}
          >
            <span className="bl-dot" aria-hidden="true" />
            <span className="bl-step-l">
              {side === "QUINCE" ? QUINCE_SHORT[s] : vendorStripLabel(s)}
            </span>
          </li>
        ))}
      </ol>

      {error ? (
        <div className="bar bar--danger">
          <Icon name="alert_triangle" />
          <div>{error}</div>
        </div>
      ) : null}

      {/* ACTIONS — QUINCE ONLY, decision J7.
      
          The vendor used to get this picker too, and Akshay was right that
          it made no sense: "I didn't understand what the functionality of
          'Move this bid on' is… Can't we clean this up so that they simply
          click on 'Submit', and automatically the status moves to the next
          stage?"
      
          Submitting a quote already advances the ladder (submitAdvancesTo,
          2a.9), so the picker was a SECOND manual way to do what Submit
          does, sitting beside it and worded in system terms. The vendor has
          exactly two moves — submit, which the form owns, and withdraw,
          which the page header owns — so neither belongs here.
      
          Quince keeps it, because clearing a quote, asking for a revision
          and not proceeding are real choices between real alternatives. The
          asymmetry is the design. */}
      {side === "QUINCE" && moves.length ? (
        <div className="bl-act">
          <>
              <label className="bl-act-l" htmlFor="bl-move">
                Move this bid
              </label>
              <select
                id="bl-move"
                className="control"
                value={moveTo}
                onChange={(e) => setMoveTo(e.target.value as BidStatus | "")}
              >
                <option value="">Choose…</option>
                {moves.map((t) => (
                  <option key={t.to} value={t.to}>
                    {t.label}
                  </option>
                ))}
              </select>
            </>

          {/* What the vendor will read, before the move is taken. */}
          {chosen ? (
            <p className="bl-will">
              They will see <strong>{chosen.vendorWillSee}</strong>
            </p>
          ) : null}

          {moveTo ? (
            <>
              <div className="control textarea">
                <textarea
                  rows={2}
                  value={note}
                  placeholder="Tell them why — this is what they read"
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
              <button
                className="btn btn--secondary btn--sm"
                disabled={busy || !note.trim()}
                onClick={() => send({ to: moveTo, note })}
              >
                Confirm
              </button>
            </>
          ) : null}

        </div>
      ) : null}

      <BidThread
        messages={data.comments}
        side={side}
        as={threadAs}
        open={threadAs === "panel" ? threadOpen : threadOpen}
        onClose={() => setThreadOpen(false)}
        busy={busy}
        onSend={async (body) => {
          await send({ note: body });
        }}
      />
    </div>
  );
}

/** Quince's own strip wording — internal, and shorter than its labels. */
const QUINCE_SHORT: Record<string, string> = {
  INVITED: "Invited",
  INITIAL_IN_REVIEW: "Initial in review",
  INITIAL_CLEARED: "Initial cleared",
  FULL_IN_REVIEW: "Full in review",
  FINAL_REQUESTED: "Final requested",
  FINAL_IN_REVIEW: "Final in review",
  BID_ACCEPTED: "Accepted",
};

/* VENDOR_SHORT deleted (J8). It mapped three review stages to "Reviewed",
   which claimed a review had happened while Quince was still looking — and
   being a second copy of the names, it could drift from the badge. The strip
   now reads vendorStripLabel() from the domain. */
