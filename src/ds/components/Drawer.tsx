'use client';

import * as React from 'react';
import { cx } from './cx';

export interface DrawerFrameProps extends React.HTMLAttributes<HTMLDivElement> {}

/** `.drawer-frame` — the scrim the panel slides over. Note this is NOT
 *  `.scrim`: the drawer carries its own frame so the panel can anchor to an
 *  edge inside it. */
export function DrawerFrame({ className, children, ...rest }: DrawerFrameProps) {
  return (
    <div className={cx('drawer-frame', className)} {...rest}>
      {children}
    </div>
  );
}

export interface DrawerProps extends React.HTMLAttributes<HTMLDivElement> {
  /** sm 360 — filters, navigation, short settings.
   *  lg 640 — complex forms, previews, multi-section workflows. The CEILING:
   *  past this, use a Modal or a page. Default is 480. */
  size?: 'sm' | 'lg';
  /** Anchors to the left edge instead of the right. */
  left?: boolean;
  labelledBy?: string;
}

export function Drawer({ size, left, labelledBy, className, children, ...rest }: DrawerProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      className={cx('drawer', size, left && 'left', className)}
      {...rest}
    >
      {children}
    </div>
  );
}

export interface DrawerHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Record context under the title — `.sub`. */
  sub?: React.ReactNode;
}

export function DrawerHeader({ sub, className, children, ...rest }: DrawerHeaderProps) {
  return (
    <div className={cx('drawer-h', className)} {...rest}>
      {children}
      {sub != null && <span className="sub">{sub}</span>}
    </div>
  );
}

/** Scrolls. Holding `<Field>` children directly makes this a form, so it
 *  carries `--form-field-gap` between them with nothing added to the markup. */
export function DrawerBody({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('drawer-b', className)} {...rest}>
      {children}
    </div>
  );
}

/** Sticky commit row — hairline, no fill, trailing actions. */
export function DrawerFooter({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('drawer-f', className)} {...rest}>
      {children}
    </div>
  );
}