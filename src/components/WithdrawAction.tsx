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
}) {
  const [arming, setArming] = React.useState(startArmed);
  const [reason, setReason] = React.useState("");

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
      <div className="control textarea">
        <textarea
          id="bl-withdraw-why"
          rows={2}
          value={reason}
          placeholder="No capacity in Q1 for this size run…"
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      <div className="bl-withdraw-acts">
        {startArmed ? null : (
          <button
            className="btn btn--ghost sm"
            onClick={() => {
              setArming(false);
              setReason("");
            }}
          >
            Cancel
          </button>
        )}
        <button
          className="btn btn--secondary sm"
          disabled={busy || !reason.trim()}
          onClick={() => onConfirm(reason)}
        >
          Withdraw
        </button>
      </div>
      <p className="bl-will">You can reinstate this bid at any time.</p>
    </div>
  );
}
