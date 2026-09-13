'use client';

import * as React from 'react';
import { cx } from './cx';
import { Icon } from './Icon';

/* ── A NOTE ON THE MARKUP, because it is a real constraint ──
   The storybook renders `.opt` rows as <label class="opt"> with a decorative
   <span class="checkbox">. That is correct for a STATIC demo, where the label
   is the control. It cannot carry a real <input>, because the system ships no
   visually-hidden utility to suppress the native box, and inventing one is a
   system change with a checkpoint — not something a React wrapper decides.

   So the interactive components below use the OTHER pattern the CSS already
   documents (components.css:614-620):

     "a grid's checkbox column has no room for that row's touch floor, so there
      the box IS the control — which means a button, not a span. A bare span
      with cursor: pointer looks clickable and is unfocusable, un-keyboardable
      and silent."

   `button.checkbox` has an explicit focus-visible rule in the CSS, so it is
   focusable, keyboard-operable, and announced. The cost against the <label>
   pattern is that clicking the LABEL TEXT does not toggle — only the box does.
   That gap is logged in react/README.md; closing it properly means adding a
   documented visually-hidden class to the system. */

export interface CheckboxProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'type'> {
  checked?: boolean;
  /** Partial selection — its OWN state, not a lighter checked. "Some of these
   *  rows" and "all of these rows" lead to different next clicks. */
  mixed?: boolean;
  onChange?: (checked: boolean) => void;
}

export const Checkbox = React.forwardRef<HTMLButtonElement, CheckboxProps>(
  function Checkbox({ checked, mixed, onChange, className, onClick, ...rest }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        role="checkbox"
        aria-checked={mixed ? 'mixed' : Boolean(checked)}
        className={cx('checkbox', checked && !mixed && 'on', mixed && 'mixed', className)}
        onClick={(e) => {
          onClick?.(e);
          if (!e.defaultPrevented) onChange?.(!checked);
        }}
        {...rest}
      >
        {mixed ? <Icon name="minus" /> : checked ? <Icon name="check" /> : null}
      </button>
    );
  },
);

export interface RadioProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'type'> {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
}

export const Radio = React.forwardRef<HTMLButtonElement, RadioProps>(
  function Radio({ checked, onChange, className, onClick, ...rest }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        role="radio"
        aria-checked={Boolean(checked)}
        className={cx('radio', checked && 'on', className)}
        onClick={(e) => {
          onClick?.(e);
          if (!e.defaultPrevented) onChange?.(true);
        }}
        {...rest}
      />
    );
  },
);

export interface ToggleProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'type'> {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
}

export const Toggle = React.forwardRef<HTMLButtonElement, ToggleProps>(
  function Toggle({ checked, onChange, className, onClick, ...rest }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        role="switch"
        aria-checked={Boolean(checked)}
        className={cx('toggle', checked && 'on', className)}
        onClick={(e) => {
          onClick?.(e);
          if (!e.defaultPrevented) onChange?.(!checked);
        }}
        {...rest}
      />
    );
  },
);

export interface OptionRowProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Label leading, control trailing — the shape a toggle row takes. */
  between?: boolean;
}

/** `.opt` — the row that holds a selection control and its label at the
 *  pointer touch floor (32px, or 44px under `pointer: coarse`). */
export function OptionRow({ between, className, children, ...rest }: OptionRowProps) {
  return (
    <div className={cx('opt', between && 'between', className)} {...rest}>
      {children}
    </div>
  );
}