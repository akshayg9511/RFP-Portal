'use client';

import * as React from 'react';
import { cx } from './cx';

/** Variants, exactly as ds/usage.js documents them.
 *  primary → secondary → ghost is descending weight in an action row. */
export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'danger'
  | 'danger-secondary';

export type ButtonSize = 'sm' | 'md' | 'lg';

/** The two filled variants. Their spinner takes `.on-accent` so it reads
 *  against the fill rather than against the surface. */
const FILLED: ReadonlySet<ButtonVariant> = new Set(['primary', 'danger']);

/** Swallows activation while the action is in flight. Separate named function so
 *  the identity is stable across renders and React does not rebind the handler. */
function guardWhileBusy(e: React.MouseEvent<HTMLButtonElement>) {
  e.preventDefault();
  e.stopPropagation();
}

interface Base {
  variant?: ButtonVariant;
  /** sm — dense chrome, pointer input. md — default. lg — prominent CTA. */
  size?: ButtonSize;
  /** Secondary with the hue removed — the way out of a destructive decision.
   *  Only meaningful on `secondary`. */
  neutral?: boolean;
  /** Full width: one action owning its container. Never beside another button. */
  block?: boolean;
  /** Working state. Puts a spinner in the leading glyph's slot so the label and
   *  the width both hold, and the variant keeps its own fill so the spinner has
   *  the surface it was tuned for — loading and disabled are different states.
   *  Sets `aria-disabled` + `aria-busy` and swallows activation; it does NOT set
   *  the `disabled` attribute, which would drop focus to <body> mid-action.
   *  A form that submits on Enter from a text field must guard its own onSubmit;
   *  this only covers activation of the button itself. */
  loading?: boolean;
}

export interface ButtonProps
  extends Base,
    Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  className?: string;
  /** Square, icon-only. Requires `aria-label`; the glyph carries no name. */
  icon?: false;
}

export interface IconButtonProps
  extends Base,
    Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  className?: string;
  icon: true;
  /** Required — an icon-only control has no visible label to name it. */
  'aria-label': string;
}

/**
 * `.btn` — a control that ACTS on the surface the user is already on.
 * Navigation is a Link, not a ghost button.
 *
 * Hierarchy is a property of the SCREEN, not of this component: one primary and
 * one secondary per screen, everything after that is ghost. Nothing here
 * enforces that — `QDS_LINT()` does, against the rendered page.
 */
export const Button = React.forwardRef<
  HTMLButtonElement,
  ButtonProps | IconButtonProps
>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    neutral,
    block,
    loading,
    icon,
    className,
    children,
    disabled,
    type,
    onClick,
    ...rest
  },
  ref,
) {
  const cls = cx(
    'btn',
    `btn--${variant}`,
    neutral && variant === 'secondary' && 'neutral',
    size !== 'md' && size,
    icon && 'icon',
    block && 'block',
    loading && 'loading',
    className,
  );

  return (
    <button
      ref={ref}
      // A bare <button> in a form defaults to type=submit. Explicit, so a
      // toolbar button never submits the form it happens to sit inside.
      type={type ?? 'button'}
      className={cls}
      // LOADING IS NOT DISABLED. `disabled` is for an action that is
      // unavailable; loading is one that is happening. They also behave
      // differently for keyboard users: setting `disabled` on a focused button
      // moves focus to <body> and drops it from the tab order, so someone who
      // just pressed Enter on Save loses their place mid-action and a screen
      // reader loses the context with it. aria-disabled keeps both.
      disabled={disabled}
      aria-disabled={loading || undefined}
      aria-busy={loading || undefined}
      // aria-disabled announces the state; it does NOT block activation. This is
      // the half that actually prevents the double fire, and it covers the
      // keyboard too, because Enter and Space on a focused button dispatch click.
      onClick={loading ? guardWhileBusy : onClick}
      {...rest}
    >
      {loading && (
        <span className={cx('spinner', 'sm', FILLED.has(variant) && 'on-accent')} />
      )}
      {children}
    </button>
  );
});

export interface ButtonSplitProps extends React.HTMLAttributes<HTMLSpanElement> {}

/** `.btn-split` — a commit action plus its overflow trigger, sharing one edge.
 *  Both children take the SAME variant; the divider comes from the CSS. */
export function ButtonSplit({ className, children, ...rest }: ButtonSplitProps) {
  return (
    <span className={cx('btn-split', className)} {...rest}>
      {children}
    </span>
  );
}