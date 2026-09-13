'use client';

import * as React from 'react';
import { cx } from './cx';
import { Icon } from './Icon';
import type { IconName } from './iconNames';

export type FeedbackTone = 'info' | 'success' | 'warning' | 'danger';

/** The tone→glyph map the storybook already uses. Shared with Toast, so a
 *  warning is the same triangle wherever it appears. */
export const TONE_GLYPH: Record<FeedbackTone, IconName> = {
  info: 'info_circle',
  success: 'check_circle',
  warning: 'alert_triangle',
  danger: 'alert_circle',
};

export interface BannerProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  tone: FeedbackTone;
  /** Neutral, not the tone — the glyph and the fill carry that. */
  title: React.ReactNode;
  /** Omit for a single-line banner. If it needs a second sentence, it is not
   *  the `single` variant. */
  description?: React.ReactNode;
  /** The ONE action. Ghost only: a filled or outlined control floats on the
   *  tinted fill. Two actions make this a decision, and a decision belongs in
   *  the page. */
  action?: React.ReactNode;
  onDismiss?: () => void;
  /** Names the dismiss. */
  dismissLabel?: string;
  /** Full bleed above the nav — no radius, no border. Content is wrapped in
   *  `.inner`, centred to --size-page-max so the text aligns with the layout
   *  underneath instead of sitting flush to the window edge. */
  global?: boolean;
}

/**
 * `.bar` — PERSISTENT status about the page. It does not time out: a condition
 * still true when the banner disappears has been hidden rather than resolved.
 * That is what separates it from a Toast.
 */
export const Banner = React.forwardRef<HTMLDivElement, BannerProps>(function Banner(
  { tone, title, description, action, onDismiss, dismissLabel, global: isGlobal, className, ...rest },
  ref,
) {
  const single = description == null;
  const content = (
    <>
      <Icon name={TONE_GLYPH[tone]} filled />
      <div className="body">
        <div className="ttl">{title}</div>
        {description != null && <div className="desc">{description}</div>}
      </div>
      {action && <div className="acts">{action}</div>}
      {onDismiss && (
        <button type="button" className="x" aria-label={dismissLabel ?? 'Dismiss'} onClick={onDismiss}>
          <Icon name="close" />
        </button>
      )}
    </>
  );

  return (
    <div
      ref={ref}
      // Not role="alert": a banner is present when the page renders rather than
      // arriving, and alert interrupts whatever a screen reader is reading.
      // A banner that appears in response to an action should get role="status".
      className={cx('bar', `bar--${tone}`, single && 'single', isGlobal && 'bar--global', className)}
      {...rest}
    >
      {isGlobal ? <div className="inner">{content}</div> : content}
    </div>
  );
});