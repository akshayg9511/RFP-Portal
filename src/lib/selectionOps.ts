/**
 * SELECTION REDUCERS — the decisions, lifted out of the React context so
 * they can be tested without a DOM.
 *
 * The provider in `selection.tsx` is a thin shell over these. Every rule that
 * is easy to get wrong lives here: what an empty variation list means, when a
 * product leaves the selection, and how a stale session restores.
 */

export type SelectedStyle = {
  id: string;
  styleNumber: string;
  name: string;
  division: string;
  department: string;
  annualSpend: number;
  /** EMPTY = the whole product. A style-grained product has nothing finer. */
  variationIds?: string[];
  variationTotal?: number;
};

export type SelectionMap = Map<string, SelectedStyle>;

/** Tick or untick a whole product. */
export function toggleStyle(
  current: SelectionMap,
  style: SelectedStyle,
): SelectionMap {
  const next = new Map(current);
  if (next.has(style.id)) next.delete(style.id);
  else next.set(style.id, style);
  return next;
}

/**
 * Add a batch, with TOGGLE semantics.
 *
 * If every one is already in, this deselects them all — which is what lets
 * one "Select all / Deselect all" button serve both jobs on the catalog and
 * the style-set page. Changing it to a plain add would break both.
 */
export function addMany(
  current: SelectionMap,
  styles: SelectedStyle[],
): SelectionMap {
  const next = new Map(current);
  const allIn = styles.every((s) => next.has(s.id));
  for (const s of styles) {
    if (allIn) next.delete(s.id);
    else next.set(s.id, s);
  }
  return next;
}

/**
 * Tick or untick ONE variation.
 *
 * Two rules that matter:
 *  - ticking a variation on an unselected product selects the product with
 *    just that variation, so a child row is a way INTO the selection;
 *  - unticking the last variation removes the product entirely, because a
 *    product with zero variations travelling onward would read as "the whole
 *    product" — the opposite of what the user just did.
 */
export function toggleVariation(
  current: SelectionMap,
  style: SelectedStyle,
  variationId: string,
  /**
   * How many variations the product HAS.
   *
   * Required for `isPartial` to work: without it a product ticked one
   * variation at a time has a total of 0, so "2 of 5" reads as fully
   * selected and the parent checkbox shows a tick instead of a dash. The
   * caller always knows this — it just rendered the rows.
   */
  variationTotal?: number,
): SelectionMap {
  const next = new Map(current);
  const existing = next.get(style.id);
  const ids = new Set(existing?.variationIds ?? []);

  if (ids.has(variationId)) ids.delete(variationId);
  else ids.add(variationId);

  if (ids.size === 0) next.delete(style.id);
  else {
    next.set(style.id, {
      ...style,
      ...existing,
      variationIds: [...ids],
      variationTotal:
        variationTotal ?? existing?.variationTotal ?? style.variationTotal,
    });
  }

  return next;
}

/** Select every variation of a product at once (the parent checkbox). */
export function selectAllVariations(
  current: SelectionMap,
  style: SelectedStyle,
  variationIds: string[],
): SelectionMap {
  const next = new Map(current);
  const entry = next.get(style.id);
  const already = new Set(entry?.variationIds ?? []);
  const allIn =
    variationIds.length > 0 && variationIds.every((id) => already.has(id));

  if (allIn) next.delete(style.id);
  else {
    next.set(style.id, {
      ...style,
      variationIds: [...variationIds],
      variationTotal: variationIds.length,
    });
  }
  return next;
}

/** Some but not all — the mixed checkbox state. */
export function isPartial(current: SelectionMap, styleId: string): boolean {
  const entry = current.get(styleId);
  if (!entry) return false;
  const picked = entry.variationIds?.length ?? 0;
  const total = entry.variationTotal ?? 0;
  return picked > 0 && total > 0 && picked < total;
}

/** Selected variations across the whole selection. */
export function skuCount(current: SelectionMap): number {
  let total = 0;
  for (const entry of current.values()) {
    total += entry.variationIds?.length ?? 0;
  }
  return total;
}

/**
 * Restore from sessionStorage.
 *
 * A session stored before `variationIds` existed restores without it. Default
 * rather than trusting the shape — a stale tab must not throw on first render.
 */
export function restore(raw: string | null): SelectionMap {
  if (!raw) return new Map();
  try {
    const entries = JSON.parse(raw) as [string, SelectedStyle][];
    if (!Array.isArray(entries)) return new Map();
    return new Map(
      entries.map(([id, style]) => [
        id,
        { ...style, variationIds: style.variationIds ?? [] },
      ]),
    );
  } catch {
    return new Map();
  }
}
