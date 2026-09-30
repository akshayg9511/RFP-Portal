"use client";

import * as React from "react";
import { Icon } from "@/ds/components";

/**
 * Save the current selection as a style set.
 *
 * §3.1 calls style sets "manual, reusable" groupings — which was not true while
 * `api/style-sets` was GET-only. The selection you have already built in the
 * catalogue IS the grouping, so this names it rather than making you pick the
 * same products a second time in a separate builder.
 */
type Props = {
  open: boolean;
  onClose: () => void;
  styleIds: string[];
  onSaved: (set: { id: string; name: string; styleCount: number }) => void;
};

/**
 * Mounted only while open, and keyed by nothing else — so React discards the
 * form state on close rather than an effect resetting it. An effect that calls
 * setState on open paints one frame carrying the previous entry, and is the
 * pattern `react-hooks/set-state-in-effect` exists to catch.
 */
export function SaveAsSetDialog(props: Props) {
  if (!props.open) return null;
  return <SaveAsSetForm {...props} />;
}

function SaveAsSetForm({ onClose, styleIds, onSaved }: Props) {
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/style-sets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, description, styleIds }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.message ?? "Could not save");
      onSaved(body);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
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
        aria-labelledby="sas-title"
      >
        <div className="modal-h">
          <div className="ttl" id="sas-title">
            Save as style set
          </div>
          <button className="x" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>

        <div className="modal-b">
          <p style={{ color: "var(--color-fg-muted)", marginBlockStart: 0 }}>
            {styleIds.length} product{styleIds.length === 1 ? "" : "s"} will be
            grouped. A product can belong to several sets, so nothing is moved
            out of the sets it is already in.
          </p>

          {error ? (
            <div
              className="bar bar--danger"
              style={{ marginBlockEnd: "var(--space-md)" }}
            >
              <Icon name="alert_triangle" />
              <div>{error}</div>
            </div>
          ) : null}

          <div className="field">
            <label className="lbl" htmlFor="sas-name">
              Set name
            </label>
            <div className="control">
              <input
                id="sas-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="FY26 cost reduction priority"
                autoFocus
              />
            </div>
          </div>

          <div className="field">
            <label className="lbl" htmlFor="sas-desc">
              Description
              <span className="hint"> — optional</span>
            </label>
            {/* `.control.textarea` is the system's own variant — the base
                .control is a fixed-height row built for an input, so a bare
                textarea overflows its border and the placeholder paints over
                the label. My `.pg-comment` was working around a variant that
                already ships. */}
            <div className="control textarea">
              <textarea
                id="sas-desc"
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Why these products are grouped — what someone reopening this needs to know."
              />
            </div>
          </div>
        </div>

        {/* No Cancel. This is a FORM modal with a header x, and the system's
            rule is that two dismissals in two places for one job is worse than
            one — the footer is spent on the commit. A confirm dialog is the
            exception; a form is not. */}
        <div className="modal-f">
          <button
            className="btn btn--primary"
            onClick={submit}
            disabled={busy || !name.trim() || styleIds.length === 0}
          >
            {busy ? "Saving…" : `Save ${styleIds.length} products`}
          </button>
        </div>
      </div>
    </div>
  );
}
