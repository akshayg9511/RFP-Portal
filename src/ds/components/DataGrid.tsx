'use client';

import * as React from 'react';
import { cx } from './cx';

/* The most-used surface in the system. It ships the STRUCTURE only — surface,
   table, column widths, cell alignment — and deliberately no loading or empty
   API, because ds/usage.js rules those COMPOSITION rather than component
   surface: a skeleton is placeholder rows at the declared widths, an empty
   state is `.empty` REPLACING <tbody> (not a row inside it, or `tbody tr:hover`
   paints a hover fill across it). Both are documented under
   `components/data-grid` → states; render them as children. */

export interface DataGridSurfaceProps extends React.HTMLAttributes<HTMLDivElement> {}

/** `.data-grid-surface` — the elevated wrapper. `overflow: auto` here is what
 *  clips row fills to the radius AND lets a table wider than the page measure
 *  scroll inside the surface instead of losing its columns. The table must be
 *  wrapped; an unwrapped `.data-grid` is a lint error. */
export function DataGridSurface({ className, children, ...rest }: DataGridSurfaceProps) {
  return (
    <div className={cx('data-grid-surface', className)} {...rest}>
      {children}
    </div>
  );
}

/** How the grid represents itself BELOW THE TURN. Above it, all three are the
 *  same desktop table — this is an adaptive morphology of one Data Grid, not
 *  three components.
 *
 *  - `stacked` — each row becomes a record CARD, with the status on the primary's
 *    line. Every field survives.
 *  - `list` — a reduced, compact representation: primary, optional secondary,
 *    optional status, rule-separated. `field="detail"` cells are removed, for
 *    everybody, including assistive technology.
 *  - `columnar` — keeps the table and scrolls sideways, pinning the identifier
 *    column. A CLAIM that this table is read by comparing values down a column.
 *
 *  ALL THREE ARE OPT-IN. Omitting the prop leaves the grid on the narrow form it
 *  has always had — a block row separated by a hairline — because changing what
 *  every existing table looks like on a phone is a screen-level decision each
 *  product makes, not one the library makes for all of them at once. A grid that
 *  should move to a named representation is migrated explicitly.
 *
 *  Choose it from the workflow, not the column count: scanning wants `list`,
 *  reading one record wants `stacked`, comparing across rows wants `columnar`. */
export type DataGridMobileView = 'stacked' | 'list' | 'columnar';

export interface DataGridProps extends React.TableHTMLAttributes<HTMLTableElement> {
  /** Omitted leaves the grid on its existing narrow behaviour, so no existing
   *  grid moves. There is no default value: unspecified is its own state. */
  mobileView?: DataGridMobileView;

  /** Column widths as CSS lengths — `['26%', '28%', '24%', '22%']`. Declaring
   *  them emits a `<colgroup>`, and a `.data-grid` with one lays out FIXED.
   *
   *  That is the opt-in, and it is keyed on the widths rather than a flag on
   *  purpose: fixed layout with nothing declared divides the table into equal
   *  columns, so a 4% checkbox column becomes 20%. Keying on the declaration
   *  makes that state unreachable.
   *
   *  Declare them when the grid shows a LOADING state — a skeleton can only
   *  land where the rows will if the widths exist before the data does, and
   *  under the default auto layout they do not. Leave them off when a column
   *  holds free text that should take the room it needs; cells stop growing to
   *  fit once layout is fixed, so a column that is too narrow wraps.
   *
   *  `null` leaves a column undeclared, which under fixed layout divides the
   *  remaining width between them. */
  columns?: (string | null)[];
}

export function DataGrid({ mobileView, columns, className, children, ...rest }: DataGridProps) {
  /* Every representation emits its own class, including 'stacked'. The class-free
     state is reserved for a grid that has declared nothing, which is what keeps
     existing grids where they are. */
  return (
    <table
      className={cx('data-grid', mobileView && mobileView, className)}
      {...rest}
    >
      {columns ? (
        <colgroup>
          {columns.map((w, i) => (
            <col key={i} style={w == null ? undefined : { width: w }} />
          ))}
        </colgroup>
      ) : null}
      {children}
    </table>
  );
}

type CellAlign = {
  /** Right-aligned tabular figures — money and counts. Emits `.num`. */
  num?: boolean;
  /** This cell carries the record's date or time. In the narrow representations
   *  it is placed on the LAST line, whatever column it came from — a date is the
   *  thing a reader looks for after deciding the record matters. Orthogonal to
   *  `field`, so a timestamp can also be `secondary` or `detail`. Emits `.when`. */
  when?: boolean;
  /** Record identifier — tabular figures at the cell size. Emits `.id`.
   *  Named `idCell`, not `id`, because `id` is the HTML attribute and a
   *  boolean prop of that name shadows it. */
  idCell?: boolean;
};

export interface ThProps extends React.ThHTMLAttributes<HTMLTableCellElement>, CellAlign {}

/** Column headers OWN sort. A toolbar sort control appears only when headers
 *  cannot sort, which is rare — two ways to order one set of rows is two
 *  places the current order can disagree. */
export function Th({ num, when, idCell, className, children, ...rest }: ThProps) {
  return (
    <th className={cx(num && 'num', when && 'when', idCell && 'id', className)} {...rest}>
      {children}
    </th>
  );
}

/** What a cell IS when the table stops being a table. Above the turn these do
 *  nothing — the column header says what a value is, so no cell needs a rung of
 *  its own. Below it the header is gone, and the roles are what tell the record
 *  apart from the things said about it.
 *
 *  - `primary` — the record's identity. One per row. An unmarked grid gets this
 *    on its FIRST cell automatically, so declaring it is an improvement rather
 *    than a requirement.
 *  - `secondary` — supporting information worth scanning.
 *  - `status` — state. Keeps its Badge; sits top-right on the primary's line in
 *    both narrow representations, and takes no `data-label` (a label beside a
 *    green pill reads the state twice).
 *  - `detail` — lower priority. Visible in `stacked`, REMOVED in `list` — for
 *    assistive technology too, because a reduced view should be reduced for
 *    everybody. Only classify a field this way when it is not needed to identify
 *    or scan the record AND the information is reachable another way.
 *  - `action` — a row-level interactive slot, not a label/value field. Nothing
 *    is supplied for it; a grid with no action gets no slot and no chevron. */
export type DataGridField = 'primary' | 'secondary' | 'status' | 'detail' | 'action';

const FIELD_CLASS: Record<DataGridField, string> = {
  primary: 'ttl',
  secondary: 'sub',
  status: 'status',
  detail: 'detail',
  action: 'act',
};

export interface TdProps extends React.TdHTMLAttributes<HTMLTableCellElement>, CellAlign {
  /** Mobile field priority. Mutually exclusive, so one value rather than a set
   *  of booleans. */
  field?: DataGridField;
}

export function Td({ field, num, when, idCell, className, children, ...rest }: TdProps) {
  return (
    <td
      className={cx(field && FIELD_CLASS[field], num && 'num', when && 'when', idCell && 'id', className)}
      {...rest}
    >
      {children}
    </td>
  );
}

export interface TrProps extends React.HTMLAttributes<HTMLTableRowElement> {
  /** A selected row — `--color-bg-selected-accent`, held under the pointer
   *  (`.on:hover` keeps the selected fill, so a hovered selected row does not
   *  read as deselecting). The grid is the one selection surface that takes the
   *  brand tint; the role falls back to the neutral fill on a brand with no
   *  accent. Never the only signal — pair it with a checked `.sel` checkbox. */
  selected?: boolean;
}

export function Tr({ selected, className, children, ...rest }: TrProps) {
  return (
    <tr className={cx(selected && 'on', className)} {...rest}>
      {children}
    </tr>
  );
}