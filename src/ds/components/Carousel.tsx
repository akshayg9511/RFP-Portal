'use client';

import * as React from 'react';
import { cx } from './cx';
import { Icon } from './Icon';

export interface CarouselProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Accessible name for the region. */
  label: string;
  /** Rendered under the track — position readout and dots. */
  footer?: React.ReactNode;
  /** Names the arrows. */
  prevLabel?: string;
  nextLabel?: string;
}

/**
 * `.carousel` — the arrows are an AID, not the mechanism. `.carousel-track`
 * carries `scroll-snap-type: x mandatory` and each slide
 * `scroll-snap-align: start`, so scrolling, snapping, touch and trackpad all
 * work with no JavaScript at all.
 *
 * What this adds is the two things CSS cannot do: move the track when an arrow
 * is pressed, and know when it has reached an end so the arrow can disable.
 * Bounds are read from scroll position rather than tracked in state, so a
 * user who swipes gets the same answer as one who clicks.
 *
 * At a bound the arrow is HIDDEN, not dimmed — `.carousel-arrow:disabled` is
 * `display: none` in the CSS. This component keeps setting `disabled` exactly
 * as before; the styling is the design system's call, and it is the one place
 * the system departs from disabled-not-removed. An overlay has no row to
 * reflow, unlike Pagination's buttons.
 *
 * The trade: the arrow overlaps the track, so a click aimed at a vanishing
 * arrow lands on the slide beneath. If your slides are links, pass arrows that
 * stay put — render them without toggling `disabled` and handle the bound
 * yourself.
 */
export const Carousel = React.forwardRef<HTMLDivElement, CarouselProps>(function Carousel(
  { label, footer, prevLabel = 'Previous', nextLabel = 'Next', className, children, ...rest },
  ref,
) {
  const track = React.useRef<HTMLDivElement | null>(null);
  const [bounds, setBounds] = React.useState({ start: true, end: false });

  const measure = React.useCallback(() => {
    const el = track.current;
    if (!el) return;
    // 1px of slack: sub-pixel scroll positions never land exactly on the end.
    const max = el.scrollWidth - el.clientWidth;
    setBounds({ start: el.scrollLeft <= 1, end: el.scrollLeft >= max - 1 });
  }, []);

  React.useEffect(() => {
    measure();
    const el = track.current;
    if (!el) return;
    el.addEventListener('scroll', measure, { passive: true });
    // Slides can arrive late or resize; re-measure rather than trusting a
    // count that was right once.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener('scroll', measure);
      ro?.disconnect();
    };
  }, [measure, children]);

  const page = (dir: 1 | -1) => {
    const el = track.current;
    if (!el) return;
    // Scroll by a viewport, letting snap settle it on a slide boundary —
    // rather than by a slide width this component would have to guess at.
    el.scrollBy({ left: dir * el.clientWidth, behavior: 'smooth' });
  };

  return (
    <div ref={ref} className={cx('carousel', className)} role="region" aria-label={label} {...rest}>
      <button
        type="button"
        className="carousel-arrow prev"
        aria-label={prevLabel}
        disabled={bounds.start}
        onClick={() => page(-1)}
      >
        <Icon name="chevron_left" size="sm" />
      </button>
      <div className="carousel-track" ref={track}>
        {children}
      </div>
      <button
        type="button"
        className="carousel-arrow next"
        aria-label={nextLabel}
        disabled={bounds.end}
        onClick={() => page(1)}
      >
        <Icon name="chevron_right" size="sm" />
      </button>
      {footer && <div className="carousel-foot">{footer}</div>}
    </div>
  );
});

export interface CarouselSlideProps extends React.HTMLAttributes<HTMLDivElement> {}

export function CarouselSlide({ className, children, ...rest }: CarouselSlideProps) {
  return (
    <div className={cx('carousel-slide', className)} {...rest}>
      {children}
    </div>
  );
}