'use client';

import * as React from 'react';
import { cx } from './cx';

export type TipPlacement = 'top' | 'bottom' | 'left' | 'right';

export interface TooltipProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** The tooltip text. */
  tip: React.ReactNode;
  /** Which side the arrow sits on. */
  placement?: TipPlacement;
}

/**
 * `.tip-anchor` — shows its `.tip` on hover AND on focus, so it is reachable
 * from the keyboard. CSS-driven, no JS.
 *
 * A tooltip is NEVER the accessible name. It is unreachable by touch and gone
 * on scroll, so the name lives on the control — this renders the tip as
 * `aria-hidden` supplementary text and leaves naming to you.
 */
export function Tooltip({ tip, placement = 'top', className, children, ...rest }: TooltipProps) {
  return (
    <span className={cx('tip-anchor', className)} {...rest}>
      {children}
      <span className={cx('tip', placement)} role="tooltip">
        {tip}
      </span>
    </span>
  );
}

export interface PopoverProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Run the body in columns, divided by the column rule, and widen to suit.
   * For a popover whose groups would otherwise stack into a tall thin list —
   * from three groups. Two columns is the ceiling: a third takes the surface
   * past 700px, where an anchored overlay stops reading as attached to its
   * trigger, and that is the point the question belongs in a side panel.
   */
  cols?: boolean;
  /**
   * Rule under the title and above the actions. For a popover that has stopped
   * being one glance — a composed query the user works THROUGH, not a list they
   * read. An ordinary popover separates on padding alone.
   */
  divided?: boolean;
}

/**
 * `.popover` — a small surface anchored to a trigger. Structure only:
 * positioning, outside-click and Escape belong to your popover primitive.
 *
 * Focus moves in on open and is NOT trapped — unlike a modal, a popover is a
 * companion to the page rather than an interruption of it.
 */
export function Popover({ cols, divided, className, children, ...rest }: PopoverProps) {
  return (
    <div className={cx('popover', cols && 'cols', divided && 'divided', className)} {...rest}>
      {children}
    </div>
  );
}

export function PopoverHeader({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('popover-h', className)} {...rest}>
      {children}
    </div>
  );
}

/** Holding fields makes this a form. Groups separate by --popover-group-gap
 *  (24), which has to stand clear of the 8px that stacks controls INSIDE a
 *  group — at 12 the two spacings read the same and a group boundary looks
 *  like one more row. Under `cols` the body runs multi-column, so it is block
 *  flow rather than flex and the gap becomes a margin. */
export function PopoverBody({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('popover-b', className)} {...rest}>
      {children}
    </div>
  );
}

/** Commit / cancel row. No hairline by default — a popover reads in one
 *  glance. Pass `divided` on the Popover when it does not: a composed query
 *  needs its commit row fenced off from the fields above it. */
export function PopoverFooter({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('popover-f', className)} {...rest}>
      {children}
    </div>
  );
}