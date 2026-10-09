'use client';

import * as React from 'react';
import { cx } from './cx';

/* ── DIVIDER ───────────────────────────────────────────────
   A hairline, or a caption sitting in the gap of one. */

export interface DividerProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Between inline items. Stretches to the row and declares no height. */
  vertical?: boolean;
  /** Inside a padded surface — starts where the text does. */
  inset?: boolean;
  /** Caption in the gap. Renders `.divider-label` instead of a bare rule. */
  label?: React.ReactNode;
}

export function Divider({ vertical, inset, label, className, ...rest }: DividerProps) {
  if (label != null) {
    return (
      <div className={cx('divider-label', inset && 'inset', className)} {...rest}>
        {label}
      </div>
    );
  }
  return (
    <div
      // Decorative by default: a rule between sections is a visual device, and
      // a separator announced to a screen reader on every gap is noise. Pass
      // role="separator" explicitly where it genuinely divides meaning.
      role="presentation"
      className={cx('divider', vertical && 'vert', inset && 'inset', className)}
      {...rest}
    />
  );
}

/* ── TEXT ──────────────────────────────────────────────────
   Typographic treatments. These are utilities, not a component with its own
   box — `as` lets them land on whatever element the content actually is. */

export type TextTone = 'default' | 'muted';

export interface TextProps extends React.HTMLAttributes<HTMLElement> {
  /** Element to render. Defaults to <span>. */
  as?: keyof React.JSX.IntrinsicElements;
  /** --type-emphasis-weight. */
  emphasis?: boolean;
  /** --color-neutral-foreground-muted-enabled — 4.9:1, and the only step down from default. The system
   *  carries TWO text tones, not three. */
  tone?: TextTone;
  /** Tabular figures in the brand sans. For a figure read down a column or one
   *  that ticks live — never a monospace face, which reads as a terminal. */
  num?: boolean;
  /** Single-line ellipsis. Needs a `min-width: 0` flex parent to take effect. */
  truncate?: boolean;
  /** Multi-line clamp. Sets --txt-clamp-lines; the CSS default is 2. */
  clamp?: number | true;
  /** Superseded value — an original price, a replaced figure. */
  strike?: boolean;
  /** 68ch measure, relaxed leading, text-wrap: pretty. Long-form copy only. */
  prose?: boolean;
}

export function Text({
  as: Tag = 'span',
  emphasis,
  tone,
  num,
  truncate,
  clamp,
  strike,
  prose,
  className,
  style,
  children,
  ...rest
}: TextProps) {
  const cls = cx(
    emphasis && 'txt-emph',
    tone === 'muted' && 'txt-muted',
    num && 'txt-num',
    truncate && 'txt-trunc',
    // Boolean(): clamp is number | true, and `clamp && …` yields 0 for clamp={0}.
    Boolean(clamp) && 'txt-clamp',
    strike && 'txt-strike',
    prose && 'txt-prose',
    className,
  );
  const s =
    typeof clamp === 'number'
      ? ({ ...style, ['--txt-clamp-lines' as string]: String(clamp) } as React.CSSProperties)
      : style;

  return React.createElement(Tag, { className: cls || undefined, style: s, ...rest }, children);
}

/* ── TIMESTAMP ─────────────────────────────────────────────
   A real <time>. `datetime` is REQUIRED, not optional: the visible string is a
   rendering choice ("2 hours ago", "11 Aug"), and the machine-readable instant
   is the only part that survives it. */

export interface TimestampProps extends Omit<React.TimeHTMLAttributes<HTMLTimeElement>, 'dateTime'> {
  /** ISO 8601 instant. Always set, whatever the visible text says. */
  dateTime: string;
  /** --color-neutral-foreground-muted-enabled, where the time is the row's subject rather than its metadata. */
  strong?: boolean;
  /** Inside a sentence — inherits the paragraph size, because a date in prose
   *  is content rather than chrome. */
  inline?: boolean;
}

export function Timestamp({ dateTime, strong, inline, className, children, ...rest }: TimestampProps) {
  return (
    <time
      dateTime={dateTime}
      className={cx('ts', strong && 'strong', inline && 'inline', className)}
      {...rest}
    >
      {children}
    </time>
  );
}