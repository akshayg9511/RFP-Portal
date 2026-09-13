'use client';

import * as React from 'react';
import { cx } from './cx';
import { Icon } from './Icon';

export interface CrumbItem {
  label: React.ReactNode;
  href?: string;
  onClick?: (e: React.MouseEvent) => void;
}

export interface BreadcrumbProps extends Omit<React.HTMLAttributes<HTMLElement>, 'children'> {
  /** Ancestor levels, root first. The LAST item is rendered as the current
   *  page — not a link. */
  items: CrumbItem[];
  /** Collapse the middle when the trail is longer than this. The first crumb
   *  is the root and the last is where you are; the middle is the part a user
   *  can reconstruct. Set 0 to never collapse. */
  collapseAfter?: number;
  /** Names the landmark when a page has more than one nav. */
  label?: string;
}

/**
 * `.crumbs` — the trail. The current page is `.cur` and carries no href:
 * rendering it as a link gives the user a control that navigates to the page
 * they are already on.
 */
export function Breadcrumb({
  items,
  collapseAfter = 4,
  label = 'Breadcrumb',
  className,
  ...rest
}: BreadcrumbProps) {
  const sep = (
    <span className="sep" aria-hidden="true">
      <Icon name="chevron_right" size="sm" />
    </span>
  );

  // Keep the first and the last two; collapse whatever is between them.
  // `null` marks the collapsed run. slice() rather than index access, so this
  // stays sound under noUncheckedIndexedAccess.
  const collapsed: Array<CrumbItem | null> =
    collapseAfter > 0 && items.length > collapseAfter
      ? [...items.slice(0, 1), null, ...items.slice(-2)]
      : [...items];

  return (
    <nav aria-label={label} className={cx('crumbs', className)} {...rest}>
      {collapsed.map((item, i) => {
        const last = i === collapsed.length - 1;
        return (
          <React.Fragment key={i}>
            {item === null ? (
              <span className="ellip" aria-hidden="true">
                …
              </span>
            ) : last ? (
              // aria-current, not just a class: the visual weight says "you are
              // here" to a sighted user and nothing at all to anyone else.
              <span className="cur" aria-current="page">
                {item.label}
              </span>
            ) : (
              <a className="crumb" href={item.href} onClick={item.onClick}>
                {item.label}
              </a>
            )}
            {!last && sep}
          </React.Fragment>
        );
      })}
    </nav>
  );
}