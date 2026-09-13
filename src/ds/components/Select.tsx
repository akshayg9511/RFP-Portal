'use client';

import * as React from 'react';
import { cx } from './cx';
import { Icon } from './Icon';

/* Presentational only. This renders the DS trigger and option-list markup and
   wires the ARIA that the markup owes; it does NOT position the menu, trap
   focus, or implement type-ahead. Pair it with your own popover primitive.
   Building a positioning engine here would put behaviour in a package whose
   job is to be a faithful skin over ds/. */

export interface SelectProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'value'> {
  /** The chosen value. Omit to render the placeholder. */
  value?: React.ReactNode;
  placeholder?: string;
  open?: boolean;
  invalid?: boolean;
  /** Toolbar rung — --size-control-sm and a 160px min-width, matching
   *  Button `sm` and Control `sm`. Pointer only. */
  sm?: boolean;
}

/** `.select` — the trigger. A <button>, and the CSS clears the UA
 *  `text-align: center` for it. Never wrap this in a `<Control>`: it draws its
 *  own border, and nesting reads as a dropdown inside a text field. */
export const Select = React.forwardRef<HTMLButtonElement, SelectProps>(function Select(
  { value, placeholder, open, invalid, sm, disabled, className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      role="combobox"
      aria-expanded={Boolean(open)}
      aria-invalid={invalid || undefined}
      disabled={disabled}
      className={cx(
        'select',
        sm && 'sm',
        open && 'open',
        invalid && 'invalid',
        disabled && 'disabled',
        className,
      )}
      {...rest}
    >
      {/* The value WRAPS rather than truncating — a clipped option label hides
          the part that distinguishes it from the one below. */}
      <span className={cx('val', value == null && 'ph')}>{value ?? placeholder}</span>
      <Icon name="chevron_down" />
    </button>
  );
});

export interface SelectMenuProps extends React.HTMLAttributes<HTMLDivElement> {}

/** `.select-menu` — also used by combobox and menu-style pickers. */
export function SelectMenu({ className, children, ...rest }: SelectMenuProps) {
  return (
    <div role="listbox" className={cx('select-menu', className)} {...rest}>
      {children}
    </div>
  );
}

export interface SelectOptionProps extends React.HTMLAttributes<HTMLDivElement> {
  selected?: boolean;
  /** Supporting line. STACKS under the label — never beside it, or the
   *  description competes with the next option's label. */
  description?: React.ReactNode;
}

export function SelectOption({
  selected,
  description,
  className,
  children,
  ...rest
}: SelectOptionProps) {
  return (
    <div
      role="option"
      aria-selected={Boolean(selected)}
      className={cx('select-opt', selected && 'on', className)}
      {...rest}
    >
      {description != null ? (
        <span className="txt">
          <span>{children}</span>
          <span className="sub">{description}</span>
        </span>
      ) : (
        children
      )}
      {selected && <Icon name="check" />}
    </div>
  );
}

/** `.select-group` — a centred caption between two hairlines. Not selectable. */
export function SelectGroup({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div role="presentation" className={cx('select-group', className)} {...rest}>
      {children}
    </div>
  );
}