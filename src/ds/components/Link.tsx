'use client';

import * as React from 'react';
import { cx } from './cx';

export interface LinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  /** Small body on its own line, below the content it relates to. */
  standalone?: boolean;
  /** Muted at rest, darkening to default on hover — for dense chrome where a
   *  column of underlines becomes noise. It costs the rest-state affordance,
   *  so it needs a context where position already says the thing is a link. */
  quiet?: boolean;
  /** Leaves the product. A SEMANTIC HOOK that draws nothing — no glyph is
   *  added, so the accessible name has to say it opens elsewhere. */
  external?: boolean;
}

/**
 * `.lnk` — navigates. Everything in an action row ACTS and is a Button; a link
 * in a modal or drawer footer is the commonest version of that mistake.
 *
 * Underlined at rest, and neutral rather than accent: the underline is the
 * affordance and the only signal that survives greyscale, so colour was doing
 * nothing twice — and a page of accent-coloured link text pulls the eye through
 * prose that should read evenly.
 */
export const Link = React.forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  { standalone, quiet, external, className, children, ...rest },
  ref,
) {
  return (
    <a
      ref={ref}
      className={cx('lnk', standalone && 'standalone', quiet && 'quiet', external && 'ext', className)}
      {...rest}
    >
      {children}
    </a>
  );
});