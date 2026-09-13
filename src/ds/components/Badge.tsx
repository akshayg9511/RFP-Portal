'use client';

import * as React from 'react';
import { cx } from './cx';
import { Icon } from './Icon';

/** Lifecycle state — four tones. `info` is the one grey: no status yet, or
 *  informational. */
export type BadgeTone = 'info' | 'success' | 'warning' | 'danger';
/** Kind, not status. Numbered because the hue means nothing outside the view
 *  that assigns it — never share a column with a status badge. */
export type BadgeCategory = 1 | 2 | 3 | 4 | 5 | 6;

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  /** A brand moment — New, Beta, the one thing to notice. Carries no meaning
   *  of its own, so one per screen or region. Tint only; `solid` is ignored. */
  accent?: boolean;
  category?: BadgeCategory;
  /** Inverts the pair — tone fills, text sits on it. The exception, one per
   *  view. Not available on `accent` or `category`, which are tint-only. */
  solid?: boolean;
}

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { tone, accent, category, solid, className, children, ...rest },
  ref,
) {
  const tintOnly = accent || category != null;
  return (
    <span
      ref={ref}
      className={cx(
        'badge',
        accent && 'badge--accent',
        category != null && `badge--cat-${category}`,
        !accent && category == null && tone && `badge--${tone}`,
        solid && !tintOnly && 'solid',
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
});

export interface StatusDotProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  /** Not started — an outline rather than a fill. */
  hollow?: boolean;
}

/** `.sdot` — never alone. Pair it with its word in a `<StatusDotRow>`, or the
 *  meaning rests on colour, which does not survive greyscale. */
export function StatusDot({ tone, hollow, className, ...rest }: StatusDotProps) {
  return (
    <span
      className={cx('sdot', tone && `sdot--${tone}`, hollow && 'hollow', className)}
      aria-hidden="true"
      {...rest}
    />
  );
}

export function StatusDotRow({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={cx('sdot-row', className)} {...rest}>
      {children}
    </span>
  );
}

/* A chip is one of two elements, and they are mutually exclusive — a dismiss
   affordance is a <button>, so a dismissible chip CANNOT also be a button
   without nesting one inside the other, which is invalid HTML.

     toggle      <button class="chip" aria-pressed="true">Pending</button>
     dismissible <span class="chip">northwind<button class="x" …/></span>

   Both shapes are in the storybook. The union below makes the illegal
   combination unrepresentable rather than leaving it to be caught in review. */

interface ChipToggleProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  /** Selected — emphasis surface. aria-pressed carries it for assistive tech. */
  selected?: boolean;
  onDismiss?: never;
  dismissLabel?: never;
}

interface ChipDismissProps extends React.HTMLAttributes<HTMLSpanElement> {
  onDismiss: () => void;
  /** Names the dismiss control — "Remove northwind", not "Remove". */
  dismissLabel: string;
  selected?: never;
}

export type ChipProps = ChipToggleProps | ChipDismissProps;

/** `.chip` — a filter chip is a BUTTON: hover, active, and the system focus
 *  ring come with the element. A chip that can be removed is a span carrying
 *  its own dismiss button instead. */
export function Chip(props: ChipProps) {
  if (props.onDismiss) {
    const { onDismiss, dismissLabel, className, children, selected: _s, ...rest } =
      props as ChipDismissProps;
    return (
      <span className={cx('chip', className)} {...rest}>
        {children}
        <button type="button" className="x" aria-label={dismissLabel} onClick={onDismiss}>
          <Icon name="close" />
        </button>
      </span>
    );
  }

  const { selected, className, children, onDismiss: _d, dismissLabel: _l, ...rest } =
    props as ChipToggleProps;
  return (
    <button
      type="button"
      // Boolean(), not the raw prop: React omits an undefined attribute
      // entirely, so an UNSELECTED chip would carry no aria-pressed at all —
      // and a toggle whose off state is unreportable is worse than one with no
      // state, because the pressed ones announce and the rest stay silent.
      aria-pressed={Boolean(selected)}
      className={cx('chip', selected && 'on', className)}
      {...rest}
    >
      {children}
    </button>
  );
}