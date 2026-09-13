'use client';

import * as React from 'react';
import { cx } from './cx';
import { Icon } from './Icon';
import type { IconName } from './iconNames';

export interface EmptyStateProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Sits on the sunken disc. */
  glyph?: IconName;
  /** Names the object that is missing — "No invoices yet", not "No data". */
  title: React.ReactNode;
  /** One line of guidance pointing at the first thing to do. Capped at 380px
   *  by the CSS, which is the measure, not a suggestion. */
  description?: React.ReactNode;
  /** Up to two: secondary leads, ghost second. A primary belongs here only
   *  when creating the missing thing is the page's own commit. */
  actions?: React.ReactNode;
  /** Inline — inside a card, a panel, or a data grid surface. */
  compact?: boolean;
}

/**
 * `.empty` — what a collection surface composes when it has nothing to show.
 *
 * Note this component has no states of its own; it IS a state. See
 * NO_STATES_EXPECTED in ds/spec.js.
 *
 * The distinction the copy has to carry: NO RECORDS names the object and
 * offers to create one. NO MATCHES names the criteria and offers to clear
 * them, and must not offer the create action — the records exist and the
 * filter is hiding them.
 */
export const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(function EmptyState(
  { glyph, title, description, actions, compact, className, ...rest },
  ref,
) {
  return (
    <div ref={ref} className={cx('empty', compact && 'compact', className)} {...rest}>
      {glyph && (
        <span className="glyph">
          <Icon name={glyph} size="lg" />
        </span>
      )}
      <div className="ttl">{title}</div>
      {description != null && <p className="desc">{description}</p>}
      {actions && <div className="acts">{actions}</div>}
    </div>
  );
});