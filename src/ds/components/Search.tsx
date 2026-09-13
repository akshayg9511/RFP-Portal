'use client';

import * as React from 'react';
import { cx } from './cx';
import { Icon } from './Icon';

export interface SearchProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** Toolbar rung — 28 Default / 36 Spacious. Pointer input only. */
  sm?: boolean;
  /** Committed terms live in the field and the box grows to fit them. Render
   *  `<Token>` children for the terms. */
  terms?: React.ReactNode;
  /** Shown only when there is something to clear — a field that permanently
   *  reserves the space for one has a dead button in it. */
  onClear?: () => void;
  clearLabel?: string;
  /** Fused to the field's leading edge. */
  scope?: React.ReactNode;
}

/**
 * `.control.search` — a `.control` with the `.search` modifier, NOT a
 * standalone class. The `.search` rules layer on the control's box; the
 * control is what draws the border and sets the height.
 *
 * Consequence: like any self-bordered control, this is never wrapped in
 * another `<Control>`.
 */
export const Search = React.forwardRef<HTMLInputElement, SearchProps>(function Search(
  { sm, terms, onClear, clearLabel = 'Clear search', scope, className, ...rest },
  ref,
) {
  const field = (
    <div className={cx('control', 'search', sm && 'sm', terms != null && 'terms', className)}>
      <Icon name="search" size="sm" />
      {terms}
      <input type="search" ref={ref} {...rest} />
      {onClear && (
        <button type="button" className="x" aria-label={clearLabel} onClick={onClear}>
          <Icon name="close" />
        </button>
      )}
    </div>
  );

  if (!scope) return field;
  return (
    <div className="search-scope">
      {scope}
      {field}
    </div>
  );
});

/** `.search-anchor` — positions the suggestion menu under the field. The
 *  positioning is CSS (`.search-anchor > .menu` is absolute), so this needs no
 *  measuring: render the field and a `<Menu>` as siblings inside it. */
export function SearchAnchor({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('search-anchor', className)} {...rest}>
      {children}
    </div>
  );
}

/** Field plus the controls that narrow it. */
export function SearchRow({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('search-row', className)} {...rest}>
      {children}
    </div>
  );
}

/** A row of preset filter chips. */
export function SearchPresets({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('search-presets', className)} {...rest}>
      {children}
    </div>
  );
}

/** Applied-criteria chips below the field, plus Clear all. Only for a bar
 *  where nothing else states the criteria — a pressed preset chip, a select
 *  naming its value, and a More-filters count are already the record. */
export function SearchApplied({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('search-applied', className)} {...rest}>
      {children}
    </div>
  );
}

/** Result count leading, sort trailing. Body size, not caption — the view
 *  always states how many rows it holds. */
export function SearchMeta({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('search-meta', className)} {...rest}>
      {children}
    </div>
  );
}

export interface SearchMatchProps extends React.HTMLAttributes<HTMLElement> {}

/** `<mark>` inside a suggestion — highlights the matched span by WEIGHT, not
 *  colour, and keeps the whole label in one element so the string stays
 *  selectable and readable. */
export function SearchMatch({ className, children, ...rest }: SearchMatchProps) {
  return (
    <mark className={className} {...rest}>
      {children}
    </mark>
  );
}

/* ── GLOBAL SEARCH ON A PHONE ─────────────────────────────────────────────
   The header's search icon opens a surface, not a dropdown: at 375 with a
   keyboard up there is no room under the field for an anchored menu.

   STRUCTURE ONLY, and the portal is the product's. `.search-view` is
   `position: fixed`, and a fixed element inside a TRANSFORMED ancestor
   positions against that ancestor rather than the viewport — so it has to be
   a child of `body`, and `QDS_MOBILE` errors when it is not. This binding
   does NOT portal it for you, for the same reason `Modal` and `Drawer` ship
   no portal, focus trap or scroll lock: those are decisions a product owns,
   and a component that quietly reparents its own subtree is one you cannot
   compose. Render it through your dialog primitive, or
   `createPortal(<SearchView/>, document.body)`.

   Everything INSIDE composes from bindings that already exist: `Search` for
   the field (add `hd-search` so it stays the muted well the app bar shows),
   `Button`/`Icon` for the back control, `Menu className="flush"` with
   `MenuLabel` and `MenuItem` for recents and results, `Badge` in the row's
   trail, `SearchMeta` for the count, `EmptyState` compact for no matches. */

export interface SearchViewProps extends React.HTMLAttributes<HTMLDivElement> {}

/** `.search-view` — the full-viewport mobile search surface. **Must be a child
 *  of `body`**; this component does not portal itself. See the note above. */
export function SearchView({ className, children, ...rest }: SearchViewProps) {
  return (
    <div className={cx('search-view', className)} {...rest}>
      {children}
    </div>
  );
}

/** `.search-view-h` — a back control and the field, and nothing else. No
 *  brandmark, no trailing actions, no breadcrumb: the mobile header caps
 *  trailing actions at two because a phone bar has one line, and here the
 *  field wants the whole line. `QDS_MOBILE` errors on anything more. */
export function SearchViewHeader({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('search-view-h', className)} {...rest}>
      {children}
    </div>
  );
}

/** `.search-view-b` — scrolls vertically, never sideways. Holds the recents
 *  or results list, the count, or the empty state. */
export function SearchViewBody({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('search-view-b', className)} {...rest}>
      {children}
    </div>
  );
}