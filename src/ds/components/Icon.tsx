'use client';

import * as React from 'react';
import { cx } from './cx';
import type { IconName } from './iconNames';
import { QICONS } from '../icons/glyphs';

/* Read through a local cast rather than `declare global`. ds/icons/Icon.d.ts
   also declares Window.QICONS — as Record<IconName, string>, required — and a
   consumer including both files would get two incompatible declarations of the
   same global. A cast keeps this package self-contained either way. */
type IconRegistry = Record<string, string | undefined>;

/* PROCURA CHANGE — was: read window.QICONS, undefined during SSR, so every
   icon server-rendered as its dashed placeholder and only corrected after
   hydration. The glyph data is now imported at module scope so it resolves
   identically on both sides. Everything below is the package's own code. */
function registry(): IconRegistry | undefined {
  return QICONS as IconRegistry;
}

export type IconSize = 'sm' | 'md' | 'lg';

export interface IconProps extends Omit<React.SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  /** sm 16 · md 20 (default) · lg 24. All three scale the same 24-unit Lucide
   *  art; the stroke holds 1.5px at every size via vector-effect, so there is no
   *  padded viewBox and no per-size compensation. 12px is NOT a size here — it is
   *  a closed list applied by component CSS, see ICON_NAMES_XS. */
  size?: IconSize;
  /** Swaps in the `_solid` cut where one exists — status and selected only. */
  filled?: boolean;
  /** Trailing position in a button; moves the optical padding trim to the end. */
  trail?: boolean;
}

/**
 * Mirrors `window.QIC()` from ds/icons/icons.js. The glyph is a Lucide stroke
 * path painted with currentColor; `.ms` in components.css sets stroke-width 1.5
 * with vector-effect: non-scaling-stroke, which holds 1.5px at every size.
 *
 * Decorative by default — aria-hidden. An icon-only control carries its own
 * aria-label on the CONTROL, never here; see the Button `icon` prop.
 */
export const Icon = React.forwardRef<SVGSVGElement, IconProps>(function Icon(
  { name, size = 'md', filled, trail, className, ...rest },
  ref,
) {
  const set = registry();
  const solid = `${name}_solid`;
  const key = filled && set?.[solid] ? solid : name;
  const body = set?.[key];

  /* `fill` is emitted as well as swapping the glyph. It is mostly a signal —
     QIC() reads it to pick the _solid cut — but it IS a styling hook in one
     place today (`.file-row > svg.ms.fill`), and `.ms.fill` is the documented
     anatomy for the Banner and Toast status icons. Swapping the path without
     the class produces the right picture and the wrong markup, so a rule added
     against `.ms.fill` later would silently skip every icon this package
     renders. */
  const cls = cx('ms', size !== 'md' && size, filled && 'fill', trail && 'trail', className);
  /* One viewBox. Lucide's 24-unit master IS the box, so the padded -2 -2 24 24
     that .lg used to need is gone — it existed only because the old expanded-
     outline art could not be thinned to hold 1px above 20px. */
  const viewBox = '0 0 24 24';

  if (!body) {
    // Same dashed placeholder QIC renders for an unknown name, so a missing
    // glyph is visible in the UI rather than silently absent.
    return (
      <svg
        ref={ref}
        className={cls}
        viewBox="0 0 24 24"
        aria-hidden="true"
        focusable="false"
        data-missing={name}
        {...rest}
      >
        <rect x="2" y="2" width="20" height="20" rx="2" fill="none"
          stroke="currentColor" strokeWidth="1" strokeDasharray="2 2" opacity=".5" />
      </svg>
    );
  }

  return (
    <svg
      ref={ref}
      className={cls}
      viewBox={viewBox}
      aria-hidden="true"
      focusable="false"
      dangerouslySetInnerHTML={{ __html: body }}
      {...rest}
    />
  );
});