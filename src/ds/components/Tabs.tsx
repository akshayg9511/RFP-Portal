'use client';

import * as React from 'react';
import { cx } from './cx';

export interface TabsProps extends React.HTMLAttributes<HTMLDivElement> {}

/** `.tabs` — the first tab sits flush with the leading edge so the row lines
 *  up with the page title and the content below. Scrolls horizontally rather
 *  than painting off the page when it outgrows its container. */
export function Tabs({ className, children, ...rest }: TabsProps) {
  return (
    <div role="tablist" className={cx('tabs', className)} {...rest}>
      {children}
    </div>
  );
}

export interface TabProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  selected?: boolean;
  /** A count for a view WAITING on the user — unreviewed, unread, failed.
   *  Not a result count on every tab: the mark only reads as attention while
   *  it is rare. Neutral by default, accent only on the selected tab, so the
   *  row carries one accent rather than two. */
  count?: React.ReactNode;
}

export const Tab = React.forwardRef<HTMLButtonElement, TabProps>(function Tab(
  { selected, count, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      role="tab"
      aria-selected={Boolean(selected)}
      className={cx('tab', selected && 'on', className)}
      {...rest}
    >
      {children}
      {count != null && <span className="ct">{count}</span>}
    </button>
  );
});

export interface SegmentedProps extends React.HTMLAttributes<HTMLDivElement> {}

/** `.seg` — a segmented control on its own track. One object with a selected
 *  segment in it, not a row of loose buttons. */
export function Segmented({ className, children, ...rest }: SegmentedProps) {
  return (
    <div role="group" className={cx('seg', className)} {...rest}>
      {children}
    </div>
  );
}

export interface SegmentProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  selected?: boolean;
}

export const Segment = React.forwardRef<HTMLButtonElement, SegmentProps>(function Segment(
  { selected, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={Boolean(selected)}
      className={cx(selected && 'on', className)}
      {...rest}
    >
      {children}
    </button>
  );
});