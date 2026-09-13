'use client';

import * as React from 'react';
import { cx } from './cx';

export interface MenuProps extends React.HTMLAttributes<HTMLDivElement> {}

/** `.menu` — an overlay list of actions. Structure only: positioning, outside
 *  click and roving focus belong to your popover primitive. */
export function Menu({ className, children, ...rest }: MenuProps) {
  return (
    <div role="menu" className={cx('menu', className)} {...rest}>
      {children}
    </div>
  );
}

export interface MenuItemProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onSelect'> {
  /** Leading glyph. Subtle until hover. */
  icon?: React.ReactNode;
  /** Keyboard shortcut, rendered in `.kbd`. */
  shortcut?: React.ReactNode;
  /** Trailing content — a submenu chevron or a value. */
  trail?: React.ReactNode;
  /** Destructive. Put it LAST, after a divider: a destructive row adjacent to
   *  an ordinary one is a misclick waiting to happen. */
  danger?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
  /** The roving tabindex. Exactly ONE item in an open menu carries 0; the rest
   *  carry -1, and the menu moves it with the arrow keys. Defaults to -1. */
  tabIndex?: number;
}

/**
 * A `role="menuitem"` div, NOT a <button>, and the difference is load-bearing.
 *
 * An ARIA menu uses a roving tabindex: the menu is one tab stop and the arrow
 * keys move within it. A set of native buttons makes every row its own tab
 * stop, which breaks that model — and `.menu-item` carries no UA reset (unlike
 * `.pager button` or `button.checkbox`, which do), so a <button> here also
 * arrives wearing the browser's own border.
 *
 * Roving focus, Escape, Home/End and type-ahead belong to the menu behaviour
 * you wrap this in. What this guarantees is the markup and the roles.
 */
export const MenuItem = React.forwardRef<HTMLDivElement, MenuItemProps>(function MenuItem(
  { icon, shortcut, trail, danger, disabled, onSelect, tabIndex = -1, className, children, onClick, onKeyDown, ...rest },
  ref,
) {
  const fire = () => { if (!disabled) onSelect?.(); };
  return (
    <div
      ref={ref}
      role="menuitem"
      // aria-disabled, not removal: a disabled item stays in place, because
      // position is how people find a repeated action and a menu whose items
      // come and go must be re-read every time.
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : tabIndex}
      className={cx('menu-item', danger && 'danger', disabled && 'disabled', className)}
      onClick={(e) => { onClick?.(e); if (!e.defaultPrevented) fire(); }}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (e.defaultPrevented) return;
        // A div is not natively activated by the keyboard; both keys, because a
        // row that answers Enter and ignores Space reads as broken.
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fire(); }
      }}
      {...rest}
    >
      {icon}
      {children}
      {shortcut != null && <span className="kbd">{shortcut}</span>}
      {trail}
    </div>
  );
});

/** `.menu-label` — a centred caption between two hairlines. Sentence case,
 *  regular weight, not selectable. */
export function MenuLabel({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div role="presentation" className={cx('menu-label', className)} {...rest}>
      {children}
    </div>
  );
}