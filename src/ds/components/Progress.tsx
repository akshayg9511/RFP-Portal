'use client';

import * as React from 'react';
import { cx } from './cx';

export interface ProgressProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  /** 0–100. Use a determinate bar whenever the total is knowable — it is the
   *  difference between waiting and waiting without knowing. */
  value: number;
  /** 4px track, for an inline row. */
  thin?: boolean;
  /** Names what is progressing. Required: a bare progressbar announces a
   *  percentage with no subject. */
  label: string;
}

/** `.progress` — a determinate bar. For unknown duration use `<Spinner>`; a bar
 *  animating on a loop is a lie about how far along the work is. */
export const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(function Progress(
  { value, thin, label, className, ...rest },
  ref,
) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      ref={ref}
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cx('progress', thin && 'thin', className)}
      {...rest}
    >
      <i style={{ inlineSize: `${pct}%` }} />
    </div>
  );
});

export interface ProgressRowProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Rendered in `.pct` — tabular figures, so the width holds as it counts up. */
  percent?: React.ReactNode;
}

/** `.progress-row` — a bar with its figure beside it. */
export function ProgressRow({ percent, className, children, ...rest }: ProgressRowProps) {
  return (
    <div className={cx('progress-row', className)} {...rest}>
      {children}
      {percent != null && <span className="pct">{percent}</span>}
    </div>
  );
}

export type SpinnerSize = 'sm' | 'md' | 'lg';

export interface SpinnerProps extends React.HTMLAttributes<HTMLSpanElement> {
  size?: SpinnerSize;
  /** Inside a filled button — the track takes the on-accent pair so it reads
   *  against the fill rather than against the surface. */
  onAccent?: boolean;
  /** Accessible name. Omit ONLY when the spinner sits inside a control that
   *  already carries aria-busy and its own name, as `<Button loading>` does —
   *  there the spinner is decorative and a second name is noise. */
  label?: string;
}

/** `.spinner` — indeterminate. */
export const Spinner = React.forwardRef<HTMLSpanElement, SpinnerProps>(function Spinner(
  { size = 'md', onAccent, label, className, ...rest },
  ref,
) {
  return (
    <span
      ref={ref}
      className={cx('spinner', size !== 'md' && size, onAccent && 'on-accent', className)}
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      {...rest}
    />
  );
});