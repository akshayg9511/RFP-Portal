"use client";

import * as React from "react";
import { Checkbox, Icon, Token } from "@/ds/components";
import type { Facet } from "@/components/FacetSelect";

/**
 * The Quince Core filter & sort pattern, as one component.
 *
 * Aravind's review (C4, C13, C15, C19, C27, C39, C66) asked every list screen
 * to follow "filter & sort" from the Patterns page instead of a row of
 * selects. The pattern, in order:
 *
 *   search → ONE facet select → More filters (popover, checkbox groups)
 *   → applied criteria as tokens underneath → the count, once.
 *
 * Sort is NOT here: the column headers own it (see SortTh).
 *
 * Built for the RFP list first; Bid summary, Award summary, Vendors, Catalog
 * and Variation setup move onto it in the shared-components phase.
 */

export type FilterGroup = {
  key: string;
  label: string;
  options: Facet[];
  selected: string[];
};

export function FilterBar({
  search,
  facet,
  groups,
  onGroupsChange,
  meta,
}: {
  search: {
    value: string;
    onChange: (v: string) => void;
    placeholder: string;
  };
  /** The one dimension people narrow by most on this screen. */
  facet?: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    options: Facet[];
    /** Placeholder naming the dimension and its unset-ness: "Select status". */
    placeholder: string;
    /** Display text for a raw value, e.g. "ISSUED" → "Issued". */
    format?: (v: string) => string;
  };
  /** Everything past the facet, behind More filters. */
  groups?: FilterGroup[];
  onGroupsChange?: (next: Record<string, string[]>) => void;
  /** The count, when the collection has no pager to carry it. */
  meta?: React.ReactNode;
}) {
  const applied = (groups ?? []).flatMap((g) =>
    g.selected.map((value) => ({ group: g, value })),
  );

  function remove(groupKey: string, value: string) {
    if (!groups || !onGroupsChange) return;
    onGroupsChange(
      Object.fromEntries(
        groups.map((g) => [
          g.key,
          g.key === groupKey ? g.selected.filter((v) => v !== value) : g.selected,
        ]),
      ),
    );
  }

  function clearAll() {
    if (!groups || !onGroupsChange) return;
    onGroupsChange(Object.fromEntries(groups.map((g) => [g.key, []])));
  }

  return (
    <div className="filter-bar">
      <div className="fb-controls">
        <div className="control search">
          <Icon name="search" size="sm" />
          <input
            placeholder={search.placeholder}
            aria-label={search.placeholder}
            value={search.value}
            onChange={(e) => search.onChange(e.target.value)}
          />
          {search.value ? (
            <button
              type="button"
              className="x"
              aria-label="Clear search"
              onClick={() => search.onChange("")}
            >
              <Icon name="close" size="sm" />
            </button>
          ) : null}
        </div>
        <div className="fb-filters">
          {facet ? (
            <select
              className={facet.value ? "control" : "control fb-ph"}
              aria-label={`Filter by ${facet.label}`}
              value={facet.value}
              onChange={(e) => facet.onChange(e.target.value)}
            >
              {/* No "All" option: nothing selected already means all. Picking
                  the placeholder again is how the user clears it. */}
              <option value="">{facet.placeholder}</option>
              {facet.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {facet.format ? facet.format(o.value) : o.value} ({o.count})
                </option>
              ))}
            </select>
          ) : null}
          {groups?.length && onGroupsChange ? (
            <MoreFilters groups={groups} onApply={onGroupsChange} />
          ) : null}
        </div>
      </div>

      {applied.length ? (
        <div className="filter-applied">
          {applied.map(({ group, value }) => (
            <Token
              key={`${group.key}:${value}`}
              qualifier={group.label}
              onDismiss={() => remove(group.key, value)}
              dismissLabel={`Remove ${group.label} ${value}`}
            >
              {value}
            </Token>
          ))}
          <button type="button" className="btn btn--ghost sm" onClick={clearAll}>
            Clear all
          </button>
        </div>
      ) : null}

      {meta ? <div className="filter-meta">{meta}</div> : null}
    </div>
  );
}

/**
 * More filters: a popover of checkbox groups with Apply / Reset.
 *
 * Up to four groups fit a popover (three or four run in two columns); five or
 * more belong in a side panel. Edits are a draft until Apply, because
 * re-running the list on every tick shows states nobody asked for.
 */
function MoreFilters({
  groups,
  onApply,
}: {
  groups: FilterGroup[];
  onApply: (next: Record<string, string[]>) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<Record<string, string[]>>({});
  const wrap = React.useRef<HTMLDivElement>(null);
  const active = groups.reduce((n, g) => n + g.selected.length, 0);

  React.useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggleOpen() {
    if (!open) {
      setDraft(Object.fromEntries(groups.map((g) => [g.key, g.selected])));
    }
    setOpen((v) => !v);
  }

  function toggle(key: string, value: string) {
    setDraft((prev) => {
      const current = prev[key] ?? [];
      return {
        ...prev,
        [key]: current.includes(value)
          ? current.filter((v) => v !== value)
          : [...current, value],
      };
    });
  }

  return (
    <div className="fb-more" ref={wrap}>
      <button
        type="button"
        className="btn btn--ghost"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={toggleOpen}
      >
        <Icon name="slider" size="sm" />
        More filters
        {/* No pill at zero: a count of zero is not a count. */}
        {active ? <span className="ct">{active}</span> : null}
      </button>
      {open ? (
        <div
          className={groups.length >= 3 ? "popover divided cols" : "popover divided"}
          role="dialog"
          aria-label="More filters"
        >
          <div className="popover-h">
            More filters
            <button type="button" className="x" aria-label="Close" onClick={() => setOpen(false)}>
              <Icon name="close" size="sm" />
            </button>
          </div>
          <div className="popover-b">
            {groups.map((g) => (
              <fieldset className="fb-group" key={g.key}>
                <legend>{g.label}</legend>
                {g.options.length ? (
                  g.options.map((o) => {
                    const id = `fb-${g.key}-${o.value}`;
                    const checked = (draft[g.key] ?? []).includes(o.value);
                    return (
                      <div className="opt" key={o.value}>
                        <Checkbox
                          id={id}
                          checked={checked}
                          onChange={() => toggle(g.key, o.value)}
                        />
                        <label htmlFor={id}>
                          {o.value} <span className="fb-n">{o.count}</span>
                        </label>
                      </div>
                    );
                  })
                ) : (
                  <p className="fb-none">None yet</p>
                )}
              </fieldset>
            ))}
          </div>
          <div className="popover-f">
            <button
              type="button"
              className="btn btn--secondary sm"
              onClick={() =>
                setDraft(Object.fromEntries(groups.map((g) => [g.key, []])))
              }
            >
              Reset
            </button>
            <button
              type="button"
              className="btn btn--primary sm"
              onClick={() => {
                onApply(draft);
                setOpen(false);
              }}
            >
              Apply
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
