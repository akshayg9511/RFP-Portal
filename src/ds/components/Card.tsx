'use client';

import * as React from 'react';
import { cx } from './cx';

export type CardElevation = 'raised' | 'flat' | 'overlay';

interface CardBase extends React.HTMLAttributes<HTMLDivElement> {
  /** raised (default) — an object on the page, no outline.
   *  flat — no shadow, muted border; for a card nested in another surface.
   *  overlay — a floating surface, likewise borderless. */
  elevation?: CardElevation;
  /** Container drops its padding so `.card-h` / `.card-b` / `.card-f` pad
   *  themselves and dividers run edge to edge. */
  split?: boolean;
}

/* `interactive` is a PREREQUISITE, not a peer. Every state a card can hold is
   styled only in combination with it — `.card.interactive.on`,
   `.card.interactive[aria-disabled="true"]`, `.card.interactive:active` — so a
   plain card has no states to carry, and `<Card selected>` on its own asks for
   a rule that does not exist. The union below makes that unrepresentable rather
   than silently dropping the class, which is what this component did before.
   Hover, active and focus stay OUT of the API: they are transient pseudo-states
   the CSS owns, and a prop for them would let the render disagree with the
   pointer. */

/** A plain surface. Nothing answers the pointer, so there is no state. */
export interface StaticCardProps extends CardBase {
  interactive?: false;
  selected?: never;
  disabled?: never;
}

/** A card that ACTS — the whole surface is the target. */
export interface InteractiveCardProps extends CardBase {
  interactive: true;
  /** The chosen card — inset ring + selected border. */
  selected?: boolean;
  disabled?: boolean;
}

export type CardProps = StaticCardProps | InteractiveCardProps;

/** `.card` — elevated by default. A shadow and a border are two answers to
 *  "where does this surface end", so an elevated card carries no outline. */
export const Card = React.forwardRef<HTMLDivElement, CardProps>(function Card(props, ref) {
  const { elevation = 'raised', split, className, children, ...rest } = props;
  /* Narrowed rather than destructured off the union: on the static branch these
     are `never`, so reading them directly would widen the type back. */
  const interactive = props.interactive === true;
  const selected = interactive && props.selected === true;
  const disabled = interactive && props.disabled === true;
  const { interactive: _i, selected: _s, disabled: _d, ...attrs } = rest as Record<string, unknown>;
  return (
    <div
      ref={ref}
      className={cx(
        'card',
        // `raised` is the default in CSS; the class is kept only for existing
        // markup, so emitting it adds nothing.
        elevation === 'flat' && 'flat',
        elevation === 'overlay' && 'overlay',
        split && 'split',
        interactive && 'interactive',
        selected && 'on',
        className,
      )}
      aria-disabled={disabled || undefined}
      {...(attrs as React.HTMLAttributes<HTMLDivElement>)}
    >
      {children}
    </div>
  );
});

export interface CardSlotProps extends React.HTMLAttributes<HTMLDivElement> {}

export function CardHeader({ className, children, ...rest }: CardSlotProps) {
  return (
    <div className={cx('card-h', className)} {...rest}>
      {children}
    </div>
  );
}

export function CardTitle({ className, children, ...rest }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={cx('ttl', className)} {...rest}>
      {children}
    </span>
  );
}

export function CardBody({ className, children, ...rest }: CardSlotProps) {
  return (
    <div className={cx('card-b', className)} {...rest}>
      {children}
    </div>
  );
}

/** Shared surface footer — hairline, no fill, LEADING actions.
 *  Actions attached to an object take ghost weight, not primary. */
export function CardFooter({ className, children, ...rest }: CardSlotProps) {
  return (
    <div className={cx('card-f', className)} {...rest}>
      {children}
    </div>
  );
}

export interface MetricProps extends React.HTMLAttributes<HTMLDivElement> {
  label: React.ReactNode;
  value: React.ReactNode;
  /** Adds `.txt-num` — tabular figures, for a value that ticks live. A static
   *  metric stays proportional: it is compared with nothing, and the padding
   *  tabular puts around a 1 reads as mechanical at display size. */
  live?: boolean;
}

/** `.k` / `.v` — the metric pair a dashboard card carries. */
export function Metric({ label, value, live, className, ...rest }: MetricProps) {
  return (
    <div className={className} {...rest}>
      <div className="k">{label}</div>
      <div className={cx('v', live && 'txt-num')}>{value}</div>
    </div>
  );
}