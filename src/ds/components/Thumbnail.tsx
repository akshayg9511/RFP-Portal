'use client';

import * as React from 'react';
import { cx } from './cx';
import { Icon } from './Icon';

export type ThumbnailState = 'blank' | 'uploading' | 'processing';

interface ThumbnailBase extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** 32 — beside a small control. 48 is the default, and there is no large. */
  sm?: boolean;
  /** People only. Things stay square. */
  round?: boolean;
  /** Per-instance size override. Not a way back to a large thumbnail. */
  size?: string;
  /** Removable — renders the dismiss disc in the top trailing corner. */
  onRemove?: () => void;
  /** Names the dismiss control. Required when onRemove is set. */
  removeLabel?: string;
  /** Selectable — wraps the tile's content in a `button.pick` that fills it, so
   *  the whole picture is the target. Combines freely with `onRemove`: the two
   *  controls are SIBLINGS inside the tile, never nested, because a button
   *  inside a button is invalid HTML and the browser un-nests it. */
  onSelect?: () => void;
  /** Names the picking control. Required when onSelect is set — the tile is a
   *  picture, so nothing else gives the button an accessible name. */
  selectLabel?: string;
  /** The chosen tile. Emits `.thumb.on` (the inset neutral ring) and
   *  `aria-current` on the picking control — the ring belongs to the tile, the
   *  current-ness to the thing you press. Also suppresses the hover veil, since
   *  the tile already chosen has nothing left to offer. */
  current?: boolean;
}

export interface ThumbnailProps extends ThumbnailBase {
  src?: string;
  alt?: string;
  /** blank — no image. uploading — in flight. processing — transferred but not
   *  ready, which is its own state because it can fail after the upload
   *  succeeded. Omit for the loaded state. */
  state?: ThumbnailState;
  /** Remainder count in a stack ("+4"). Replaces the tile content — never
   *  layered over a glyph or an image. */
  more?: React.ReactNode;
}

/**
 * `.thumb` — a fixed tile. It holds its size in every state so a grid does not
 * reflow when an image lands.
 */
export const Thumbnail = React.forwardRef<HTMLSpanElement, ThumbnailProps>(function Thumbnail(
  { src, alt, state, more, sm, round, size, onRemove, removeLabel, onSelect, selectLabel, current, className, style, ...rest },
  ref,
) {
  const s = size
    ? ({ ...style, ['--thumb-size' as string]: size } as React.CSSProperties)
    : style;

  /* The placeholder glyph follows the tile's SHAPE, and nothing else. A square
     stands in for a thing (camera); a round tile stands in for a person
     (profile), because `round` already MEANS a person and a camera inside one is
     the component contradicting itself. What is forbidden is guessing from
     incidental context — a tile reading "invoice" off the row it sits in turns a
     placeholder into a category label. A declared variant is not incidental. */
  const placeholder = <Icon name={round ? 'profile' : 'camera'} />;

  /* No src, no count, no state is still a tile with nothing to show, so it IS
     the blank state — and since v167 `.blank` carries the placeholder surface
     rather than `.thumb`, a tile that does not claim it renders transparent. The
     contract has always called `.blank` the fallback for a missing or failed
     image; this is what makes that true rather than advisory. */
  /* An image that FAILS is the other way into this state, and it is the one the
     component can detect for itself. The contract has always called .blank the
     fallback for a failed image; before this it was advice to the app. */
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => { setFailed(false); }, [src]);

  const blank = more == null && state == null && (!src || failed);
  const body =
    more != null ? (
      <span className="more">{more}</span>
    ) : state === 'blank' || blank ? (
      placeholder
    ) : src ? (
      <img src={src} alt={alt ?? ''} onError={() => setFailed(true)} />
    ) : null;

  // The picking surface comes FIRST so the dismiss, which is also positioned,
  // paints and receives clicks on top of it. There is no z-index in this
  // component and the DOM order is what holds that.
  return (
    <span
      ref={ref}
      className={cx('thumb', sm && 'sm', round && 'round', state, blank && 'blank', current && 'on', className)}
      style={s}
      {...rest}
    >
      {onSelect ? (
        <button
          type="button"
          className="pick"
          aria-label={selectLabel}
          aria-current={current || undefined}
          onClick={onSelect}
        >
          {body}
        </button>
      ) : (
        body
      )}
      {onRemove && (
        <button type="button" className="x" aria-label={removeLabel ?? 'Remove'} onClick={onRemove}>
          <Icon name="close" />
        </button>
      )}
    </span>
  );
});

/** `.thumb-stack` — overlapping tiles, each ringed in the surface colour. Put
 *  the remainder count on the LAST child via `more`. */
export function ThumbnailStack({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={cx('thumb-stack', className)} {...rest}>
      {children}
    </span>
  );
}