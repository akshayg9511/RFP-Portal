"use client";

import * as React from "react";

/**
 * Withdraw from a product — decisions J4 and J9.
 *
 * Akshay, 5 Oct: "when the vendor wants to withdraw, they click on it and
 * add a note about why they are withdrawing", and the control belongs in the
 * page header rather than buried in the status panel.
 *
 * It sits at the LEADING edge of the action row as a ghost, so it is never
 * adjacent to Submit. The note step is the misclick guard: the first click
 * only opens the question, and nothing is sent until a reason is written —
 * so a stray click costs one Cancel, never a withdrawal.
 */
export function WithdrawAction({
  reinstate,
  busy,
  startArmed = false,
  onConfirm,
  onCancel,
}: {
  /** Already withdrawn — there is nothing to withdraw from. */
  reinstate: boolean;
  busy?: boolean;
  /**
   * Skip the "are you sure" click when this is already inside a modal the
   * vendor opened deliberately (L1). The two-step guard exists because the
   * button used to sit beside the primary commit; a modal IS that guard, so
   * asking twice would be ceremony.
   */
  startArmed?: boolean;
  onConfirm: (reason: string) => void;
  /** In a modal, Cancel closes it (Aravind, C64). */
  onCancel?: () => void;
}) {
  const [arming, setArming] = React.useState(startArmed);
  const [reason, setReason] = React.useState("");
  // Withdraw is always clickable; an empty reason is reported ON the field
  // rather than leaving a greyed button that reads as a label (C64).
  const [missing, setMissing] = React.useState(false);

  if (reinstate) return null;

  if (!arming) {
    return (
      <button
        className="btn btn--ghost bl-withdraw"
        onClick={() => setArming(true)}
      >
        Withdraw
      </button>
    );
  }

  return (
    <div className="bl-withdraw-form">
      <label className="bl-act-l" htmlFor="bl-withdraw-why">
        Why are you withdrawing? Quince will see this.
      </label>
      <div className={missing ? "control textarea invalid" : "control textarea"}>
        <textarea
          id="bl-withdraw-why"
          rows={2}
          value={reason}
          aria-invalid={missing || undefined}
          aria-describedby={missing ? "bl-withdraw-err" : undefined}
          placeholder="No capacity in Q1 for this size run…"
          onChange={(e) => {
            setReason(e.target.value);
            if (e.target.value.trim()) setMissing(false);
          }}
        />
      </div>
      {missing ? (
        <p className="bl-withdraw-err" id="bl-withdraw-err">
          Tell Quince why you are withdrawing.
        </p>
      ) : null}
      <div className="bl-withdraw-acts">
        <button
          className="btn btn--secondary sm"
          onClick={() => {
            if (startArmed) {
              onCancel?.();
              return;
            }
            setArming(false);
            setReason("");
            setMissing(false);
          }}
        >
          Cancel
        </button>
        <button
          className="btn btn--danger sm"
          disabled={busy}
          onClick={() => {
            if (!reason.trim()) {
              setMissing(true);
              return;
            }
            onConfirm(reason);
          }}
        >
          Withdraw
        </button>
      </div>
      <p className="bl-will">You can reinstate this bid at any time.</p>
    </div>
  );
}
