"use client";

import * as React from "react";
import { Icon } from "@/ds/components";
import {
  actionLabel,
  noteRequired,
  resumeTarget,
  transitionsFrom,
  vendorLabel,
  type BidStatus,
} from "@/domain/bidStatus";

/**
 * "Move this bid" as a MENU BUTTON (Aravind, C17/C33: "Move this to the top
 * right of the drawer. This should ideally be a menu button").
 *
 * Offers only the moves legal from the current status (domain/bidStatus.ts),
 * then asks for the required note in a small popover before anything is
 * sent — the same rule as the drawer's old select (3.12). Used in two places
 * with one behaviour: the drawer header, and as a row quick action on the
 * RFP page (Akshay, 8 Oct: "whatever options are there in the right drawer,
 * we just add a button as quick action").
 */
export function BidMoveMenu({
  invitationId,
  styleId,
  status,
  onMoved,
  size = "sm",
  label = "Review",
}: {
  invitationId: string;
  styleId: string;
  status: BidStatus;
  onMoved?: () => void;
  size?: "sm" | "md";
  label?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [to, setTo] = React.useState<BidStatus | null>(null);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const wrap = React.useRef<HTMLDivElement>(null);

  // The vendor's own moves (submit, withdraw) live on their screen, not here.
  const moves = transitionsFrom(status, "QUINCE");

  React.useEffect(() => {
    if (!open && !to) return;
    function onDown(e: MouseEvent) {
      if (wrap.current && !wrap.current.contains(e.target as Node)) close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, to]);

  function close() {
    setOpen(false);
    setTo(null);
    setNote("");
    setError(null);
  }

  // ux/15: Revision and Decline need feedback; Advance and Accept may carry it.
  const required = to ? noteRequired(status, to) : false;
  // Where the bid will actually land — Reopen goes back to its stage.
  const lands = to && status === "NOT_PROCEEDING" ? resumeTarget(status, null) : to;

  async function confirm() {
    if (!to || (required && !note.trim())) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/bids/${invitationId}/${styleId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ authorSide: "QUINCE", to, note: note.trim() }),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b?.message ?? "Could not move this bid");
      close();
      onMoved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not move this bid");
    } finally {
      setBusy(false);
    }
  }

  if (!moves.length) return null;

  return (
    <div className="bm-wrap" ref={wrap}>
      <button
        type="button"
        className={size === "sm" ? "btn btn--secondary sm" : "btn btn--secondary"}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open || to ? close() : setOpen(true))}
      >
        {label}
        <Icon name="chevron_down" size="sm" />
      </button>

      {open && !to ? (
        <div className="bm-menu" role="menu">
          <div className="menu-label">Your review</div>
          {moves.map((m) => (
            <button
              key={m.to}
              type="button"
              role="menuitem"
              className={m.to === "NOT_PROCEEDING" ? "menu-item bm-danger" : "menu-item"}
              onClick={() => {
                setTo(m.to);
                setOpen(false);
              }}
            >
              {actionLabel(status, m.to)}
            </button>
          ))}
        </div>
      ) : null}

      {to ? (
        <div className="popover divided bm-note" role="dialog" aria-label="Add a note">
          <div className="popover-h">{actionLabel(status, to)}</div>
          <div className="popover-b">
            {status !== "NOT_PROCEEDING" && lands ? (
              <p className="bm-will">
                The vendor will see <strong>{vendorLabel(lands)}</strong>
              </p>
            ) : (
              <p className="bm-will">Returns the bid to the stage it was declined at, with the vendor.</p>
            )}
            <div className="control textarea">
              <textarea
                rows={3}
                autoFocus
                value={note}
                aria-label="Feedback for the vendor"
                placeholder={
                  to === "NOT_PROCEEDING"
                    ? "Why you are declining — the vendor reads this, so keep it vendor-safe"
                    : required
                      ? "Your feedback — what should change, and why"
                      : "Feedback for the vendor (optional)"
                }
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            {error ? <p className="bm-error">{error}</p> : null}
          </div>
          <div className="popover-f">
            <button type="button" className="btn btn--secondary sm" onClick={close}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--primary sm"
              disabled={busy || (required && !note.trim())}
              onClick={confirm}
            >
              {busy ? "Saving…" : actionLabel(status, to)}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
