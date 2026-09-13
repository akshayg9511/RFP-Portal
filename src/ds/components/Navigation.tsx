'use client';

import * as React from 'react';
import { cx } from './cx';

export interface NavDrawerProps extends React.HTMLAttributes<HTMLElement> {
  /** Dark surface, fixed in both modes. Separates by its border and drops the
   *  shadow — a dark panel cannot cast one usefully. */
  dark?: boolean;
  /** Nav parts without the drawer's own surface and border, for when the
   *  surrounding panel already provides them (`.shell > .pn`). */
  bare?: boolean;
  /** This nav lists SECTIONS of the record on screen, not destinations in the
   *  product — the rail beside a long form. Below the turn it becomes a
   *  DISCLOSURE: the current step over a progress bar, expanding to the full list
   *  on tap, so the form and not the map occupies the first screen. A declaration
   *  and never an inference: a product nav collapsed the same way would strand
   *  the destination the user is on, and no markup separates the two, so the
   *  consumer says which this is.
   *
   *  THE CHILDREN HAVE A REQUIRED SHAPE, because the collapse is native
   *  `<details>` rather than a runtime. Pass one `<details>` (no `open`
   *  attribute) whose `<summary>` carries the current step's label in a `.lbl`, a
   *  chevron_down, and a `.progress.thin`; the `.nav-item` rows follow it inside
   *  the same `<details>`. Above the turn the summary is hidden and the content is
   *  force-opened, so the same markup is the full panel there. The label and the
   *  bar's width are yours to supply — CSS cannot read text out of the current row
   *  or count siblings into a width — so derive both from the list you render the
   *  rows from.
   *
   *  Only the standalone drawer form can be a section rail, so this has no
   *  effect together with `bare` — a bare nav sits inside `.shell > .pn`, which
   *  is the product nav by definition. */
  sections?: boolean;
  label?: string;
}

/**
 * `.nav-drawer` — the vertical destination list. Pass `bare` when it sits
 * inside a `<ShellPanel>`, which already carries the surface: two surfaces
 * nested is a panel inside a panel.
 */
export function NavDrawer({ dark, bare, sections, label = 'Main', className, children, ...rest }: NavDrawerProps) {
  return (
    <nav aria-label={label} className={cx(bare ? 'nav' : 'nav-drawer', dark && 'dark', !bare && sections && 'sections', className)} {...rest}>
      {children}
    </nav>
  );
}

export interface NavItemProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  /** Current destination. Carried by the label weight AND colour, never the
   *  fill alone — the selected fill measures 1.52:1 and is a supporting signal. */
  selected?: boolean;
  /** Leading glyph. In main navigation an icon is not decoration: the same
   *  items are scanned daily and the glyph becomes the landmark — and it is
   *  the only identifier once the rail collapses. */
  icon?: React.ReactNode;
  /** A destination WAITING on the user — unreviewed, unread, failed. Not a
   *  total: the mark only reads as attention while it is rare. */
  count?: React.ReactNode;
}

/**
 * `.nav-item` — a real anchor, so it is a link, opens in a new tab, and is
 * reachable by keyboard for free. The label is wrapped in `.lbl`: the
 * truncation rule and the collapse rule both hang off that class, so a bare
 * text node wraps out of its fixed-height row and cannot be hidden in the rail.
 */
export const NavItem = React.forwardRef<HTMLAnchorElement, NavItemProps>(function NavItem(
  { selected, icon, count, className, children, ...rest },
  ref,
) {
  return (
    <a
      ref={ref}
      className={cx('nav-item', selected && 'on', className)}
      aria-current={selected ? 'page' : undefined}
      {...rest}
    >
      {icon}
      <span className="lbl">{children}</span>
      {count != null && <span className="ct">{count}</span>}
    </a>
  );
});

/** `.grp` — a centred caption between two hairlines. Sentence case, regular
 *  weight, not a destination. */
export function NavGroup({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('grp', className)} {...rest}>
      {children}
    </div>
  );
}

/** `.nav-bar` — the same items laid out horizontally in a header. Selected is
 *  accent TEXT with no fill: a horizontal row has no row to fill. */
export function NavBar({ label = 'Main', className, children, ...rest }: NavDrawerProps) {
  return (
    <nav aria-label={label} className={cx('nav-bar', className)} {...rest}>
      {children}
    </nav>
  );
}

export interface NavRailProps extends React.HTMLAttributes<HTMLElement> {
  dark?: boolean;
  label?: string;
}

/** `.nav-rail` — 76px, glyph in a pill with the label beneath. The label is
 *  ALWAYS visible here, which is what separates a rail from a collapsed
 *  panel: the rail is a layout choice, the collapse is a state. */
export function NavRail({ dark, label = 'Main', className, children, ...rest }: NavRailProps) {
  return (
    <nav aria-label={label} className={cx('nav-rail', dark && 'dark', className)} {...rest}>
      {children}
    </nav>
  );
}

export interface NavRailItemProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  selected?: boolean;
  icon?: React.ReactNode;
}

export const NavRailItem = React.forwardRef<HTMLAnchorElement, NavRailItemProps>(function NavRailItem(
  { selected, icon, className, children, ...rest },
  ref,
) {
  return (
    <a
      ref={ref}
      className={cx('ritem', selected && 'on', className)}
      aria-current={selected ? 'page' : undefined}
      {...rest}
    >
      <span className="pill">{icon}</span>
      <span className="rlabel">{children}</span>
    </a>
  );
});