"use client";

import * as React from "react";
import { Icon } from "@/ds/components";
import { STRIP, stripPosition, type BidStatus } from "@/domain/bidStatus";

/**
 * Where a bid stands — ONE block, the same on every surface that shows a bid
 * (the RFP page's drawer, the Bid summary drawer, the vendor's quote page).
 *
 * Akshay, 8 Oct: the row of "Changes requested · ⓘ · Vendor sees Changes
 * requested · Move this bid" plus a separate "Latest note: refill" bar was
 * not clean. So the facts are ranked and given one place each:
 *
 *   1. the status, large, with the action at the trailing edge
 *   2. how far along it is — "Step 2 of 7" — which opens the lifecycle IN
 *      PLACE as a vertical stepper (no floating tooltip to clip)
 *   3. what the other side reads, only when it differs
 *   4. the latest note, as a quotation with who and when, and the way to
 *      the conversation
 */

const STEP_LABEL: Record<string, string> = {
  INVITED: "Invited",
  INITIAL_IN_REVIEW: "Initial quote in review",
  INITIAL_CLEARED: "Initial quote cleared",
  FULL_IN_REVIEW: "Full costing in review",
  FINAL_REQUESTED: "Final bid requested",
  FINAL_IN_REVIEW: "Final bid in review",
  BID_ACCEPTED: "Accepted",
};

export type PanelNote = { body: string; author: string; at: string | null };

export function BidStatusPanel({
  status,
  label,
  otherSide,
  note,
  changedAt,
  tone = "neutral",
  action,
  onViewConversation,
}: {
  status: BidStatus;
  /** The status in THIS reader's words. */
  label: string;
  /** What the other party reads — shown only when it differs from `label`. */
  otherSide?: { who: string; label: string };
  note?: PanelNote | null;
  changedAt?: string | null;
  /** "attention" when the reader owes the next move. */
  tone?: "neutral" | "attention" | "closed";
  action?: React.ReactNode;
  onViewConversation?: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const here = stripPosition(status);
  const onLadder = STRIP.includes(status);
  const closed = status === "WITHDRAWN" || status === "NOT_PROCEEDING";
  const stepText = closed
    ? "Closed"
    : here >= 0
      ? `Step ${here + 1} of ${STRIP.length}${onLadder ? "" : " · in revision"}`
      : "";

  return (
    <section className={`bsp bsp--${closed ? "closed" : tone}`} aria-label="Bid status">
      <div className="bsp-top">
        <div className="bsp-state">
          <span className="bsp-dot" aria-hidden="true" />
          <span className="bsp-label">{label}</span>
        </div>
        {action ? <div className="bsp-act">{action}</div> : null}
      </div>

      <div className="bsp-meta">
        {stepText ? (
          <button
            type="button"
            className="bsp-steps-toggle"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {stepText}
            <Icon name={open ? "chevron_up" : "chevron_down"} size="sm" />
          </button>
        ) : null}
        {changedAt ? (
          <span className="bsp-when">
            Updated{" "}
            {new Date(changedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
          </span>
        ) : null}
        {otherSide && otherSide.label !== label ? (
          <span className="bsp-other">
            {otherSide.who} sees <strong>{otherSide.label}</strong>
          </span>
        ) : null}
      </div>

      {open ? (
        <ol className="bsp-steps">
          {STRIP.map((s, i) => (
            <li
              key={s}
              className={i < here ? "is-done" : i === here ? "is-here" : undefined}
              aria-current={i === here ? "step" : undefined}
            >
              <span className="bsp-step-mark" aria-hidden="true">
                {i < here ? <Icon name="check" size="sm" /> : null}
              </span>
              {STEP_LABEL[s] ?? s}
            </li>
          ))}
        </ol>
      ) : null}

      {note?.body ? (
        <figure className="bsp-note">
          <blockquote>{note.body}</blockquote>
          <figcaption>
            <span>
              {note.author}
              {note.at
                ? ` · ${new Date(note.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
                : ""}
            </span>
            {onViewConversation ? (
              <button type="button" className="bsp-link" onClick={onViewConversation}>
                View conversation
                <Icon name="arrow_right" size="sm" />
              </button>
            ) : null}
          </figcaption>
        </figure>
      ) : null}
    </section>
  );
}
