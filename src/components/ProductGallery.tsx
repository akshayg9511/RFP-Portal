"use client";

import * as React from "react";

/**
 * Hero image plus a thumbnail strip, with optional colourway switching.
 *
 * Extracted from StyleDetail so the vendor quote form and the Playground can
 * use it. Roughly 620 of the ~700 seeded images were reachable from exactly one
 * drawer: every other screen filtered `isHero: true, take: 1`. A vendor pricing
 * a product could see one photograph of it.
 *
 * Deliberately not the design system's `.carousel`: that is a scroll-snap track
 * whose arrows vanish when disabled, and its own docs warn a click aimed at a
 * vanishing arrow lands on the slide beneath. A thumbnail strip has no such
 * trap and shows the whole set at once.
 */

export type Colourway = { id: string; name: string; images: string[] };

export function ProductGallery({
  images,
  colourways = [],
  alt,
  compact = false,
}: {
  /** Style-level images, in position order. Used when a colourway has none. */
  images: string[];
  colourways?: Colourway[];
  alt: string;
  /** Smaller hero, for a sidebar rather than a full drawer. */
  compact?: boolean;
}) {
  const [colourway, setColourway] = React.useState(0);
  const [image, setImage] = React.useState(0);

  // A colourway with no images of its own falls back to the style's set — the
  // load-bearing bit, since colourway coverage is uneven.
  const gallery = colourways[colourway]?.images.length
    ? colourways[colourway].images
    : images;

  // Clamp rather than reset in an effect: switching colourway can leave the
  // index past the end, and an effect would paint one frame of nothing.
  const index = Math.min(image, Math.max(0, gallery.length - 1));

  if (!gallery.length) return null;

  return (
    <div className={compact ? "detail-gallery is-compact" : "detail-gallery"}>
      <div className="detail-hero">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={gallery[index]} alt={alt} />
      </div>

      {/* Thumbnails and variants are ONE side column, so they wrap together
          rather than competing for the same line and leaving a dead gap
          between them. */}
      <div className="gallery-aside">
        {gallery.length > 1 ? (
          <div className="detail-thumbs">
            {gallery.map((url, i) => (
              <button
                key={`${i}-${url}`}
                className={i === index ? "on" : undefined}
                onClick={() => setImage(i)}
                aria-label={`Image ${i + 1} of ${gallery.length}`}
                aria-pressed={i === index}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" loading="lazy" />
              </button>
            ))}
          </div>
        ) : null}

        {colourways.length > 1 ? (
          <div className="gallery-colourways">
            {colourways.map((c, i) => (
              <button
                key={c.id}
                className={i === colourway ? "chip on" : "chip"}
                aria-pressed={i === colourway}
                onClick={() => {
                  setColourway(i);
                  setImage(0);
                }}
              >
                {c.name}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
