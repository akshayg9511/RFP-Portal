'use client';

import * as React from 'react';
import { cx } from './cx';
import { Icon } from './Icon';

export interface AccordionProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Borderless, hairline-separated — docs and FAQ. */
  flush?: boolean;
}

/** `.acc` — no separators inside: the container edge groups the items. */
export function Accordion({ flush, className, children, ...rest }: AccordionProps) {
  return (
    <div className={cx('acc', flush && 'flush', className)} {...rest}>
      {children}
    </div>
  );
}

export interface AccordionItemProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title' | 'onToggle'> {
  title: React.ReactNode;
  /** Count or summary shown while collapsed. */
  trail?: React.ReactNode;
  open?: boolean;
  onToggle?: (open: boolean) => void;
}

/**
 * `.acc-item` — header plus body. The body is UNMOUNTED when collapsed rather
 * than hidden with CSS: a screen reader that can reach every panel at once is
 * reading the whole document, which is what the accordion exists to prevent.
 */
export function AccordionItem({
  title,
  trail,
  open,
  onToggle,
  className,
  children,
  ...rest
}: AccordionItemProps) {
  const id = React.useId();
  return (
    <div className={cx('acc-item', open && 'open', className)} {...rest}>
      <button
        type="button"
        className="acc-h"
        aria-expanded={Boolean(open)}
        aria-controls={`${id}-body`}
        onClick={() => onToggle?.(!open)}
      >
        {title}
        {trail != null && <span className="trail">{trail}</span>}
        {/* The chevron is the state signal that survives greyscale — the CSS
            rotates it 180° on .open. */}
        <Icon name="chevron_down" className="chev" />
      </button>
      {open && (
        <div id={`${id}-body`} className="acc-b">
          {children}
        </div>
      )}
    </div>
  );
}