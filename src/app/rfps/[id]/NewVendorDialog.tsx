"use client";

import * as React from "react";
import { Icon } from "@/ds/components";

/** The 26 countries the real Lauren Home template offers. */
const COUNTRIES = [
  "China", "Cambodia", "Thailand", "Vietnam", "India", "Sri Lanka",
  "Bangladesh", "Indonesia", "Peru", "Italy", "Mexico", "Turkey",
  "Guatemala", "Pakistan", "Portugal", "Morocco", "Malaysia", "Spain",
];

export type CreatedVendor = {
  id: string;
  vendorCode: string;
  name: string;
  cooRegion: string | null;
  isTemp: boolean;
};

/**
 * Create a vendor who is not yet in the Quince ecosystem.
 *
 * The code is generated server-side — two letters of the name plus an
 * incrementing number — and the vendor is marked temp until they are onboarded
 * through the existing vendor portal process.
 */
export function NewVendorDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (vendor: CreatedVendor) => void;
}) {
  const [name, setName] = React.useState("");
  const [country, setCountry] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setName("");
    setCountry("");
    setEmail("");
    setError(null);

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/vendors/new", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, country, email }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.message ?? "Could not create");
      onCreated(body as CreatedVendor);
      onClose();
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
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="nv-title">
        <div className="modal-h">
          <div className="ttl" id="nv-title">
            Add a new vendor
          </div>
          <button className="x" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>

        <div className="modal-b">
          <p style={{ color: "var(--color-neutral-foreground-muted-enabled)", marginBlockStart: 0 }}>
            They get a temporary code until they are onboarded through the
            vendor portal.
          </p>

          {error ? (
            <div className="bar bar--danger" style={{ marginBlockEnd: "var(--space-md)" }}>
              <Icon name="alert_triangle" />
              <div>{error}</div>
            </div>
          ) : null}

          <div className="field">
            <label className="lbl" htmlFor="nv-name">Vendor name</label>
            <div className="control">
              <input
                id="nv-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Zenith Mills"
                autoFocus
              />
            </div>
          </div>

          <div className="field">
            <label className="lbl" htmlFor="nv-country">Country of origin</label>
            <div className="control control-select">
              <select
                id="nv-country"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
              >
                <option value="">Select a country</option>
                {COUNTRIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="field">
            <label className="lbl" htmlFor="nv-email">Email</label>
            <div className="control">
              <input
                id="nv-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="bids@vendor.com"
              />
            </div>
            <div className="msg">Optional in the prototype — there is no vendor login.</div>
          </div>
        </div>

        {/* No Cancel. A FORM modal already has a header × — two dismissals in
            two places for one job, and the footer is better spent on the
            commit. A confirm dialog is the exception; a form is not. */}
        <div className="modal-f">
          <button
            className="btn btn--primary"
            onClick={submit}
            disabled={busy || !name.trim() || !country}
          >
            {busy ? "Adding…" : "Add vendor"}
          </button>
        </div>
      </div>
    </div>
  );
}
