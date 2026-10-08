"use client";

import * as React from "react";
import { Icon } from "@/ds/components";
import { STRIP, detailFor, stripPosition, type BidStatus } from "@/domain/bidStatus";

const STEP_LABEL: Record<string, string> = {
  INVITED: "Invited",
  INITIAL_IN_REVIEW: "Initial in review",
  INITIAL_CLEARED: "Initial cleared",
  FULL_IN_REVIEW: "Full in review",
  FINAL_REQUESTED: "Final requested",
  FINAL_IN_REVIEW: "Final in review",
  BID_ACCEPTED: "Accepted",
};

/**
 * The ⓘ beside a bid's status badge. Opens on hover, focus or click and lists
 * every lifecycle step with the current one marked.
 *
 * Replaces the always-visible lifecycle strip (Aravind, C57: "I don't think
 * visibility of each stage is required. If it is, it can be housed in a tool
 * tip next to status of the bid"). Akshay wanted the steps reachable so a
 * buyer can see how far along a bid is; this keeps them one hover away.
 */
export function BidStatusInfo({ status }: { status: BidStatus }) {
  const [open, setOpen] = React.useState(false);
  const here = stripPosition(status);
  const id = React.useId();

  return (
    <span
      className="bsi"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className="bsi-btn"
        aria-label="Bid lifecycle"
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="info_circle" size="sm" />
      </button>
      {open ? (
        <span className="bsi-pop" role="tooltip" id={id}>
          <span className="bsi-detail">{detailFor(status)}</span>
          <ol className="bsi-steps">
            {STRIP.map((s, i) => (
              <li
                key={s}
                className={i === here ? "on" : i < here ? "done" : undefined}
              >
                {STEP_LABEL[s] ?? s}
              </li>
            ))}
          </ol>
        </span>
      ) : null}
    </span>
  );
}
