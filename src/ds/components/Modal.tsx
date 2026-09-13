'use client';

import * as React from 'react';
import { cx } from './cx';

/* Structure only — no focus trap, no scroll lock, no portal. Those are app
   concerns and every React app already has an answer for them; wrap this in
   your dialog primitive of choice. What this guarantees is the MARKUP. */

export interface ScrimProps extends React.HTMLAttributes<HTMLDivElement> {}

/** `.scrim` — the overlay fill. One layer of interruption at a time. */
export function Scrim({ className, children, ...rest }: ScrimProps) {
  return (
    <div className={cx('scrim', className)} {...rest}>
      {children}
    </div>
  );
}

export interface ModalProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 640px — form modals. Default is 480. */
  wide?: boolean;
  /** id of the element holding the title, for aria-labelledby. */
  labelledBy?: string;
}

export function Modal({ wide, labelledBy, className, children, ...rest }: ModalProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      className={cx('modal', wide && 'wide', className)}
      {...rest}
    >
      {children}
    </div>
  );
}

export function ModalHeader({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('modal-h', className)} {...rest}>
      {children}
    </div>
  );
}

export function ModalTitle({ className, children, ...rest }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={cx('ttl', className)} {...rest}>
      {children}
    </span>
  );
}

export function ModalBody({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('modal-b', className)} {...rest}>
      {children}
    </div>
  );
}

export interface ModalFooterProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Cancel leading, commits trailing. */
  spread?: boolean;
  /** Adds the footer hairline — only for a modal whose body SCROLLS. */
  divided?: boolean;
}

/** Trailing actions by default. Two actions next to each other means
 *  primary + secondary — a ghost beside a filled button reads as one control
 *  and one piece of text, and the way out stops looking like an option. */
export function ModalFooter({ spread, divided, className, children, ...rest }: ModalFooterProps) {
  return (
    <div className={cx('modal-f', spread && 'spread', divided && 'divided', className)} {...rest}>
      {children}
    </div>
  );
}