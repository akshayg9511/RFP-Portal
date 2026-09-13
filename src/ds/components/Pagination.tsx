'use client';

import * as React from 'react';
import { cx } from './cx';
import { Icon } from './Icon';

export interface PaginationProps extends Omit<React.HTMLAttributes<HTMLElement>, 'onChange'> {
  page: number;
  pageCount: number;
  onChange: (page: number) => void;
  /** How many numbers to show around the current page before eliding. */
  siblings?: number;
  label?: string;
}

/** Builds the visible run: always the first and last page, `siblings` either
 *  side of the current one, and `null` for each elided gap. */
function pageRun(page: number, count: number, siblings: number): Array<number | null> {
  if (count <= siblings * 2 + 5) return Array.from({ length: count }, (_, i) => i + 1);
  const out: Array<number | null> = [1];
  const from = Math.max(2, page - siblings);
  const to = Math.min(count - 1, page + siblings);
  if (from > 2) out.push(null);
  for (let p = from; p <= to; p++) out.push(p);
  if (to < count - 1) out.push(null);
  out.push(count);
  return out;
}

/**
 * `.pager` — numbered pagination. Arrows disable at a bound rather than
 * disappearing: a control that vanishes reflows the row and moves the button
 * the user was aiming for.
 */
export function Pagination({
  page,
  pageCount,
  onChange,
  siblings = 1,
  label = 'Pagination',
  className,
  ...rest
}: PaginationProps) {
  const run = pageRun(page, pageCount, siblings);
  return (
    <nav aria-label={label} className={cx('pager', className)} {...rest}>
      <button
        type="button"
        className="nav"
        aria-label="Previous page"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        <Icon name="chevron_left" size="sm" />
      </button>
      {run.map((p, i) =>
        p === null ? (
          <span key={`e${i}`} className="ellip" aria-hidden="true">
            …
          </span>
        ) : (
          <button
            key={p}
            type="button"
            className={cx(p === page && 'on')}
            // The current page stays a real button and keeps its hover — a user
            // clicking it expects a refresh, not a dead control.
            aria-current={p === page ? 'page' : undefined}
            onClick={() => onChange(p)}
          >
            {p}
          </button>
        ),
      )}
      <button
        type="button"
        className="nav"
        aria-label="Next page"
        disabled={page >= pageCount}
        onClick={() => onChange(page + 1)}
      >
        <Icon name="chevron_right" size="sm" />
      </button>
    </nav>
  );
}

export interface PaginationReadoutProps extends Omit<React.HTMLAttributes<HTMLElement>, 'onChange'> {
  /** The label standing in for the number row — "21–40 of 200", "Page 5 of 10".
   *  Wrap the figures in <b> to lift them out of the muted sentence. */
  children: React.ReactNode;
  page: number;
  pageCount: number;
  onChange: (page: number) => void;
  label?: string;
  prevLabel?: string;
  nextLabel?: string;
}

/**
 * `.pager` with a `.readout` — a label in place of the numbers. For a set whose
 * page count is large or unknown, where a row of numbers is neither countable
 * nor useful; the arrows still bound.
 */
export function PaginationReadout({
  children,
  page,
  pageCount,
  onChange,
  label = 'Pagination',
  prevLabel = 'Previous page',
  nextLabel = 'Next page',
  className,
  ...rest
}: PaginationReadoutProps) {
  return (
    <nav aria-label={label} className={cx('pager', className)} {...rest}>
      <button type="button" className="nav" aria-label={prevLabel} disabled={page <= 1} onClick={() => onChange(page - 1)}>
        <Icon name="chevron_left" size="sm" />
      </button>
      <span className="readout">{children}</span>
      <button type="button" className="nav" aria-label={nextLabel} disabled={page >= pageCount} onClick={() => onChange(page + 1)}>
        <Icon name="chevron_right" size="sm" />
      </button>
    </nav>
  );
}

export interface PaginationBarProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Range readout at the leading edge — "1–25 of 1,284". Muted throughout,
   *  numbers included. The view ALWAYS states how many rows it holds. */
  info?: React.ReactNode;
}

/** `.pager-bar` — readout leading, pager trailing. */
export function PaginationBar({ info, className, children, ...rest }: PaginationBarProps) {
  return (
    <div className={cx('pager-bar', className)} {...rest}>
      {info != null && <div className="pager-info">{info}</div>}
      {children}
    </div>
  );
}

export interface PaginationDotsProps extends Omit<React.HTMLAttributes<HTMLElement>, 'onChange'> {
  count: number;
  index: number;
  onChange: (index: number) => void;
  label?: string;
}

/** `.pager.dots` — carousel position. For a handful of slides; past about seven
 *  they stop being countable and the position belongs in words. */
export function PaginationDots({
  count,
  index,
  onChange,
  label = 'Slide',
  className,
  ...rest
}: PaginationDotsProps) {
  return (
    <nav aria-label={label} className={cx('pager', 'dots', className)} {...rest}>
      {Array.from({ length: count }, (_, i) => (
        <button
          key={i}
          type="button"
          className={cx('dot', i === index && 'on')}
          aria-label={`${label} ${i + 1}`}
          aria-current={i === index ? 'true' : undefined}
          onClick={() => onChange(i)}
        />
      ))}
    </nav>
  );
}