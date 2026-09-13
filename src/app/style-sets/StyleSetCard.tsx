"use client";

import * as React from "react";
import Link from "next/link";
import { Icon } from "@/ds/components";
import { money, units } from "@/lib/format";

export type StyleSetSummary = {
  id: string;
  name: string;
  description: string | null;
  lastUsedIn: string | null;
  styleCount: number;
  annualSpend: number;
  coverImages: string[];
};

/**
 * A style set as a card with a real image carousel.
 *
 * The carousel is the documented component — a track that scroll-snaps, with
 * arrows that aid rather than drive it. No auto-advance: it moves content out
 * from under the reader.
 */
export function StyleSetCard({
  set,
  href,
}: {
  set: StyleSetSummary;
  href: string;
}) {
  const track = React.useRef<HTMLDivElement>(null);
  const [index, setIndex] = React.useState(0);

  const images = set.coverImages.slice(0, 8);

  function scrollTo(next: number) {
    const clamped = Math.max(0, Math.min(next, images.length - 1));
    setIndex(clamped);
    const slide = track.current?.children[clamped] as HTMLElement | undefined;
    slide?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
  }

  return (
    <div className="card raised set-card">
      <div className="carousel set-card-media">
        <div
          className="carousel-track"
          ref={track}
          onScroll={(event) => {
            const el = event.currentTarget;
            const width = el.clientWidth || 1;
            setIndex(Math.round(el.scrollLeft / width));
          }}
        >
          {images.length ? (
            images.map((url, i) => (
              <div className="carousel-slide" key={`${i}-${url}`} tabIndex={0}>
                {/* Product photography from the CDN. eslint's next/image rule
                    is off here deliberately: these are remote, already sized,
                    and the optimiser would proxy 1,042 of them. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" loading={i === 0 ? "eager" : "lazy"} />
              </div>
            ))
          ) : (
            <div className="carousel-slide" tabIndex={0}>
              <div className="thumb blank" />
            </div>
          )}
        </div>

        {images.length > 1 ? (
          <>
            <button
              className="carousel-arrow prev"
              aria-label="Previous image"
              hidden={index === 0}
              onClick={() => scrollTo(index - 1)}
            >
              <Icon name="chevron_left" size="sm" />
            </button>
            <button
              className="carousel-arrow next"
              aria-label="Next image"
              hidden={index >= images.length - 1}
              onClick={() => scrollTo(index + 1)}
            >
              <Icon name="chevron_right" size="sm" />
            </button>
          </>
        ) : null}
      </div>

      <div className="card-b">
        <Link className="set-card-title" href={href}>
          {set.name}
        </Link>
        {set.description ? (
          <p className="set-card-desc">{set.description}</p>
        ) : null}

        <dl className="set-card-stats">
          <div>
            <dt>Styles</dt>
            <dd>{units(set.styleCount)}</dd>
          </div>
          <div>
            <dt>Annual spend</dt>
            <dd>{money(set.annualSpend)}</dd>
          </div>
          <div>
            <dt>Last used</dt>
            <dd>{set.lastUsedIn ?? "Not yet"}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
