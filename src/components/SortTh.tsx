"use client";

import * as React from "react";
import { Icon } from "@/ds/components";

/**
 * Sortable column header — the grid's headers own sort (Aravind, C4:
 * "Sorting functionality should be embedded in column headers").
 *
 * Every sortable column carries the same two-headed `sort` mark, dimmed at
 * rest and full strength on the sorted one. The glyph never changes shape:
 * clicking the sorted column again reverses it, and aria-sort carries the
 * direction for assistive tech.
 */

export type SortDir = "asc" | "desc";
export type SortState<K extends string> = { key: K; dir: SortDir } | null;

export function SortTh<K extends string>({
  sortKey,
  sort,
  onSort,
  num,
  children,
}: {
  sortKey: K;
  sort: SortState<K>;
  onSort: (next: SortState<K>) => void;
  num?: boolean;
  children: React.ReactNode;
}) {
  const on = sort?.key === sortKey;
  return (
    <th
      className={num ? "num" : undefined}
      aria-sort={on ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
    >
      <button
        type="button"
        className="sort"
        onClick={() =>
          onSort(
            on
              ? { key: sortKey, dir: sort.dir === "asc" ? "desc" : "asc" }
              : // Numbers read largest-first; text reads A→Z.
                { key: sortKey, dir: num ? "desc" : "asc" },
          )
        }
      >
        {children}
        <Icon name="sort" size="sm" />
      </button>
    </th>
  );
}

/** Sort a copy of `rows` by the active key. Nulls always sink to the bottom. */
export function sortRows<T, K extends string>(
  rows: T[],
  sort: SortState<K>,
  value: (row: T, key: K) => string | number | null | undefined,
): T[] {
  if (!sort) return rows;
  const sign = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = value(a, sort.key);
    const vb = value(b, sort.key);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === "number" && typeof vb === "number") return (va - vb) * sign;
    return String(va).localeCompare(String(vb)) * sign;
  });
}
