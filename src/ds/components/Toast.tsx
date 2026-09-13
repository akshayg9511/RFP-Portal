'use client';

import * as React from 'react';
import { cx } from './cx';
import { Icon } from './Icon';
import { TONE_GLYPH, type FeedbackTone } from './Banner';

export type ToastTone = FeedbackTone | 'loading';

export interface ToastProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  tone: ToastTone;
  /** One line. A toast that needs a paragraph is a Banner. */
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Undo, or one follow-up. Rendered as a LINK — the documented exception in
   *  this system, because a toast is a report rather than a surface to act on. */
  action?: { label: React.ReactNode; onClick: () => void };
  onDismiss?: () => void;
  dismissLabel?: string;
}

/**
 * `.toast` — transient. It times out, which is what separates it from a Banner,
 * and that means anything the user MUST act on does not belong here: the
 * deadline for acting is a few seconds and then it is gone with no way back.
 *
 * Never takes focus. A toast that steals the caret interrupts the work it is
 * reporting on.
 */
export const Toast = React.forwardRef<HTMLDivElement, ToastProps>(function Toast(
  { tone, title, description, action, onDismiss, dismissLabel, className, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      // status, not alert: a toast reports something that already happened.
      // alert interrupts, which is for a condition the user must handle now —
      // and that is a case this component explicitly does not cover.
      role="status"
      className={cx('toast', `toast--${tone}`, className)}
      {...rest}
    >
      {tone === 'loading' ? (
        <span className="spinner sm" aria-hidden="true" />
      ) : (
        <Icon name={TONE_GLYPH[tone]} filled />
      )}
      <div className="body">
        <div className="ttl">{title}</div>
        {description != null && <div className="desc">{description}</div>}
      </div>
      {action && (
        <div className="acts">
          <button type="button" className="lnk" onClick={action.onClick}>
            {action.label}
          </button>
        </div>
      )}
      {onDismiss && (
        // A real button with an accessible name — never a bare svg.
        <button type="button" className="x" aria-label={dismissLabel ?? 'Dismiss notification'} onClick={onDismiss}>
          <Icon name="close" />
        </button>
      )}
    </div>
  );
});

/** `.toast-stack` — newest nearest the edge, with a hard ceiling on how many
 *  show at once. A column of toasts is a log, and a log belongs somewhere the
 *  user can scroll it. */
export function ToastStack({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('toast-stack', className)} aria-live="polite" {...rest}>
      {children}
    </div>
  );
}