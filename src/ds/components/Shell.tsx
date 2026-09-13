'use client';

import * as React from 'react';
import { cx } from './cx';

export interface ShellProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Panel drops to a 68px glyph rail. Labels, counts, group text and the
   *  brandmark hide — so every item needs an accessible name and a tooltip
   *  once collapsed, because the glyph becomes the only identifier. */
  navCollapsed?: boolean;
  /** Two-row shell with no sidebar track — top nav only. */
  noPanel?: boolean;
  /** Panel spans every row, so the header starts beside it. */
  panelFirst?: boolean;
  /** 280px panel for long destination names. */
  panelWide?: boolean;
}

/**
 * `.shell` — the app frame. A CSS grid with named areas (header / panel /
 * content / footer); this component contributes the class names and one
 * boolean, not a layout engine.
 *
 * Children go in `<ShellHeader>`, `<ShellPanel>`, `<ShellContent>`,
 * `<ShellFooter>`, which carry the grid areas.
 */
export const Shell = React.forwardRef<HTMLDivElement, ShellProps>(function Shell(
  { navCollapsed, noPanel, panelFirst, panelWide, className, children, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cx(
        'shell',
        navCollapsed && 'nav-collapsed',
        noPanel && 'no-panel',
        panelFirst && 'panel-first',
        panelWide && 'panel-wide',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
});

export interface ShellHeaderProps extends React.HTMLAttributes<HTMLElement> {
  /** Dark header on the same plane — top-nav-only products. */
  dark?: boolean;
}

/** Holds its edge with `--elevation-chrome-below` rather than a hairline: one
 *  device per boundary, since a line plus a shadow reads as two seams. */
export function ShellHeader({ dark, className, children, ...rest }: ShellHeaderProps) {
  return (
    <header className={cx('hd', dark && 'dark', className)} {...rest}>
      {children}
    </header>
  );
}

/** Global search in the header's centre track — 30% of the bar by default
 *  (`--hd-search-w`), centred by two equal side tracks. */
export function ShellHeaderSearch({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('hd-search', className)} {...rest}>
      {children}
    </div>
  );
}

/** Trailing group for product-wide chrome — notifications, locale, help,
 *  account. Icon-only ghost buttons; each needs an aria-label. */
export function ShellHeaderGlobal({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('hd-global', className)} {...rest}>
      {children}
    </div>
  );
}

export interface ShellPanelProps extends React.HTMLAttributes<HTMLElement> {
  /** Dark panel surface, fixed in BOTH modes — the panel is chrome that frames
   *  the product, so it holds its value while the content beside it changes. */
  dark?: boolean;
}

export function ShellPanel({ dark, className, children, ...rest }: ShellPanelProps) {
  return (
    <aside className={cx('pn', dark && 'dark', className)} {...rest}>
      {children}
    </aside>
  );
}

/** Brandmark and collapse control on one line. */
export function ShellPanelTop({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('pn-top', className)} {...rest}>
      {children}
    </div>
  );
}

export interface NavCollapseProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  collapsed?: boolean;
}

/** `.nav-collapse` — icon-only ghost button in `.pn-top`, on the panel plane.
 *  Needs an accessible name; aria-expanded carries the state. */
export const NavCollapse = React.forwardRef<HTMLButtonElement, NavCollapseProps>(function NavCollapse(
  { collapsed, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={cx('nav-collapse', className)}
      aria-expanded={!collapsed}
      {...rest}
    >
      {children}
    </button>
  );
});

export type ContentMeasure = 'wide' | 'fluid';

export interface ShellContentProps extends React.HTMLAttributes<HTMLElement> {
  /** wide — the default measure (`--container-wide`, 1440).
   *  fluid — table pages, growing with the columns. */
  measure?: ContentMeasure;
}

/** The only scrolling region. Children carry the measure and centre at it. */
export function ShellContent({ measure, className, children, ...rest }: ShellContentProps) {
  return (
    <main className={cx('ct', measure, className)} {...rest}>
      {children}
    </main>
  );
}

export function ShellFooter({ className, children, ...rest }: React.HTMLAttributes<HTMLElement>) {
  return (
    <footer className={cx('ft', className)} {...rest}>
      {children}
    </footer>
  );
}

export interface PageHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  /** The screen's h1 at `--type-page-title-*` (30 / 600). It outranks
   *  `.section > .hd`: 30 at 600 against the section's 20 at 500. */
  title: React.ReactNode;
  /** Optional breadcrumb trail above the title. */
  trail?: React.ReactNode;
  /**
   * @deprecated NOT PART OF THE SUPPORTED QUINCE PAGE HEADER ANATOMY. This prop is
   * legacy API drift, not a feature: `.sub` has no rule anywhere in the stylesheet
   * that reaches a page header (every `.sub` rule is scoped — `.select-opt .sub`,
   * `.drawer-h .sub`, `td.sub`), no story renders one, and the contract's own
   * anatomy row for `.page-hd` reads "no subtitle" in as many words. Passing it
   * therefore renders unstyled text.
   *
   * It is retained only for backward compatibility and will be REMOVED in the next
   * major release. It is deliberately not being given a `.sub` rule and not being
   * given a story, and it must not be used in new work.
   *
   * MIGRATION: descriptive content belongs in the page composition, not in the
   * header. Put the sentence in the page body — the first `.section > .hd > .desc`,
   * or a `<Text tone="muted">` above the content — where it takes real typography,
   * wraps at a readable measure, and does not compete with the `<h1>` for the one
   * line the header's actions and overflow are also aligned to.
   */
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  /** BELOW THE TURN ONLY — `display: none` above it. One icon-only ghost with
   *  `more_vertical` and an aria-label, opening a menu of the SAME actions the
   *  collection's filter strip carries in `.fb-actions`. The strip hides that
   *  group only where this slot exists, so omitting it degrades to a two-row bar
   *  rather than losing the actions.
   *
   *  It is deliberately NOT part of `actions`: below the turn `.acts` leaves the
   *  header and pins to the bottom of the shell as the commit bar, which is the
   *  right place for a decision and the wrong one for a utility. */
  overflow?: React.ReactNode;
}

/** `.page-hd` — the screen title block.
 *
 *  THE `.row` / `.grow` WRAPPERS ARE REQUIRED, and until now this component did
 *  not emit them. Every page-header rule in the stylesheet is written against
 *  `.page-hd > .row > …` — the flex row, the title column, the trailing action
 *  group, the optical lift that centres it on the title line, and the pinned
 *  action bar below the turn. `.page-hd > .acts` is styled by nothing at all, so
 *  a React page header rendered its actions as an unstyled block and silently
 *  had no mobile action bar. No live check covered it. */
export function PageHeader({ title, trail, subtitle, actions, overflow, className, ...rest }: PageHeaderProps) {
  return (
    <div className={cx('page-hd', className)} {...rest}>
      {trail}
      <div className="row">
        <div className="grow">
          <h1 className="ttl">{title}</h1>
          {subtitle != null && <div className="sub">{subtitle}</div>}
        </div>
        {actions && <div className="acts">{actions}</div>}
        {overflow && <div className="ovf">{overflow}</div>}
      </div>
    </div>
  );
}