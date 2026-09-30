"use client";

import * as React from "react";

/**
 * A filter select whose options carry counts.
 *
 * Lifted out of `products/page.tsx`, where it was private, because A8 needs
 * seven of these and the plain `<select className="control sm">` + "All X"
 * option block was hand-written in nine places across award / vendors / the
 * RFP tabs.
 *
 * COUNTS COME FROM THE FILTERED SET, so a value that would return nothing
 * reads as `(0)` rather than vanishing from the control — an option that
 * disappears looks like a bug, and the user cannot tell whether they filtered
 * it away or it never existed.
 */

export type Facet = { value: string; count: number };

export function FacetSelect({
  label,
  value,
  onChange,
  options,
  /** Override when "All " + label + "s" reads wrong ("All statuss"). */
  allLabel,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Facet[];
  allLabel?: string;
}) {
  return (
    <select
      className="control sm"
      aria-label={`Filter by ${label}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{allLabel ?? `All ${label}s`}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.value} ({o.count})
        </option>
      ))}
    </select>
  );
}

/**
 * Count occurrences of one field across rows, ordered by count.
 *
 * Mirrors the server-side `facet()` in `api/styles/route.ts` so a client-side
 * filtered view gets the same "(0) rather than gone" behaviour without a
 * round trip. `keys` seeds values that must always appear even at zero — the
 * five COO regions, for instance, where a missing region is information.
 */
export function facetsOf<T>(
  rows: T[],
  pick: (row: T) => (string | null | undefined)[] | string | null | undefined,
  keys: string[] = [],
): Facet[] {
  const counts = new Map<string, number>();
  for (const key of keys) counts.set(key, 0);

  for (const row of rows) {
    const picked = pick(row);
    const values = Array.isArray(picked) ? picked : [picked];
    // A row counts ONCE per distinct value, so a product with two ISC vendors
    // does not count twice toward ISC.
    for (const v of new Set(values)) {
      if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}
