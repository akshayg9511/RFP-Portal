"use client";

import * as React from "react";
import { Checkbox, Icon } from "@/ds/components";
import { unitCost } from "@/lib/format";

/**
 * Submit a quote — one commit, every variation.
 *
 * Akshay, 5 Oct: "submit should open a modal and preselect all variants and
 * submit all."
 *
 * The action row had FIVE buttons, two of which were submits ("Submit this
 * one only" / "Submit all 5 variations"). That put the scope decision in the
 * button labels, where it was competing for attention with Copy-to-all and
 * Save draft. Here it is the modal's own content: everything is ticked, and
 * the vendor unticks what is not ready.
 *
 * Pre-ticked rather than empty for the same reason the review-variations
 * modal is — Aravind: "having them reselect it again is just a cumbersome
 * effort." Submitting everything is the normal case.
 */

export type SubmitVariant = {
  id: string;
  label: string;
  fob: number | null;
  status: string | null;
};

export function SubmitQuoteModal({
  variants,
  busy,
  onClose,
  onSubmit,
}: {
  /** Empty for a style-grained product — then this is a plain confirm. */
  variants: SubmitVariant[];
  busy?: boolean;
  onClose: () => void;
  onSubmit: (variationIds: string[]) => void;
}) {
  /** A variant with no price cannot be submitted, so it starts unticked. */
  const ready = React.useMemo(
    () => variants.filter((v) => (v.fob ?? 0) > 0),
    [variants],
  );
  const alreadyDone = React.useMemo(
    () => variants.filter((v) => v.status === "SUBMITTED"),
    [variants],
  );

  const [picked, setPicked] = React.useState<Set<string>>(
    () => new Set(ready.filter((v) => v.status !== "SUBMITTED").map((v) => v.id)),
  );

  const notReady = variants.filter((v) => (v.fob ?? 0) <= 0);
  const selectable = ready.filter((v) => v.status !== "SUBMITTED");
  const allPicked = selectable.length > 0 && picked.size === selectable.length;

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div
      className="scrim app-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sq-title"
      >
        <div className="modal-h">
          <div className="ttl" id="sq-title">
            Submit your quote
          </div>
          <button className="x" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>

        <div className="modal-b">
          {/* NOTHING LEFT TO SEND.
          
              Every variation already submitted is a real state — a vendor
              who reopens the form and hits Submit should be told the work is
              done, not shown five disabled rows under "Submit 0
              variations". */}
          {variants.length && !selectable.length ? (
            <div className="empty compact">
              <span className="glyph">
                <Icon name="check_circle" size="lg" />
              </span>
              <div className="ttl">Everything is submitted</div>
              <div className="desc">
                All {variants.length} variations are with Quince. You can
                still talk to them in the conversation.
              </div>
            </div>
          ) : variants.length ? (
            <>
              <p className="sq-lede">
                Everything priced is selected. Untick anything you are not
                ready to send — you can submit it later.
              </p>

              {selectable.length > 1 ? (
                <label className="sq-all">
                  <Checkbox
                    checked={allPicked}
                    onChange={() =>
                      setPicked(
                        allPicked
                          ? new Set()
                          : new Set(selectable.map((v) => v.id)),
                      )
                    }
                    aria-label={`Select all ${selectable.length} variations`}
                  />
                  <span>Select all {selectable.length}</span>
                </label>
              ) : null}

              <ul className="sq-list">
                {variants.map((v) => {
                  const done = v.status === "SUBMITTED";
                  const priced = (v.fob ?? 0) > 0;
                  return (
                    <li key={v.id}>
                      <label className="sq-row">
                      <Checkbox
                        checked={picked.has(v.id)}
                        disabled={done || !priced}
                        onChange={() => toggle(v.id)}
                        aria-label={`Submit ${v.label}`}
                      />
                      <span className="sq-label">{v.label}</span>
                      <span className="sq-fob">
                        {priced ? unitCost(v.fob) : "no price yet"}
                      </span>
                      {done ? (
                        <span className="sq-done">already submitted</span>
                      ) : null}
                      </label>
                    </li>
                  );
                })}
              </ul>

              {notReady.length ? (
                <div className="bar bar--warning">
                  <Icon name="alert_triangle" />
                  <div>
                    <strong>
                      {notReady.length} variation
                      {notReady.length === 1 ? "" : "s"} have no price yet
                    </strong>{" "}
                    and cannot be submitted:{" "}
                    {notReady.map((v) => v.label).join(", ")}.
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <p className="sq-lede">
              This sends your quote to Quince. You can still talk to them in
              the conversation afterwards.
            </p>
          )}
        </div>

        <div className="modal-f">
          {/* ONE commit. The footer is spent on it, so there is no Cancel
              beside it — the header's x is the dismissal (the DS rule a
              form modal follows). */}
          {variants.length && !selectable.length ? (
            <button className="btn btn--secondary" onClick={onClose}>
              Close
            </button>
          ) : (
            <button
              className="btn btn--primary"
              disabled={busy || (variants.length > 0 && picked.size === 0)}
              onClick={() => onSubmit([...picked])}
            >
              {variants.length
                ? `Submit ${picked.size} variation${picked.size === 1 ? "" : "s"}`
                : "Submit quote"}
            </button>
          )}
          {alreadyDone.length ? (
            <span className="sq-note">
              {alreadyDone.length} already submitted and left untouched
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
