"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@/ds/components";

/**
 * The demo gate.
 *
 * Built from the design system like any other screen — a person landing here
 * should recognise it as part of Procura, not as scaffolding bolted on for a
 * tunnel.
 */
function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";

  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.message ?? "Could not sign in.");
      }
      /* replace, not push: the back button should not land on the gate after
         signing in. refresh() re-runs middleware with the new cookie. */
      router.replace(next);
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="gate">
      <form className="card gate-card" onSubmit={submit}>
        <div className="card-b">
          <div className="gate-mark" aria-hidden="true">
            <Icon name="invoice" size="lg" />
          </div>

          <h1 className="gate-ttl">Procura</h1>
          <p className="gate-sub">
            Sourcing and bidding — preview build. Enter the password you were
            given.
          </p>

          {error ? (
            <div className="bar bar--danger gate-err">
              <Icon name="alert_triangle" />
              <div>{error}</div>
            </div>
          ) : null}

          <div className="field">
            <label className="lbl" htmlFor="gate-pw">
              Password
            </label>
            <div className="control">
              <input
                id="gate-pw"
                type="password"
                value={password}
                autoFocus
                autoComplete="current-password"
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          <button
            className="btn btn--primary gate-go"
            type="submit"
            disabled={busy || !password}
          >
            {busy ? "Checking…" : "Open Procura"}
          </button>

          <p className="gate-note">
            This is a preview with made-up data. Product names and images are
            real; every price, supplier bid and award is invented.
          </p>
        </div>
      </form>
    </div>
  );
}

/**
 * `useSearchParams()` opts this route out of static prerendering, and Next
 * requires a Suspense boundary to say what to show while the URL is unknown.
 * Without it `next build` fails on this page — which `next dev` never
 * reveals, because dev does not prerender.
 */
export default function LoginPage() {
  return (
    <React.Suspense fallback={<div className="gate" />}>
      <LoginInner />
    </React.Suspense>
  );
}
