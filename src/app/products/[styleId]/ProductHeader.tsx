"use client";

import * as React from "react";
import Link from "next/link";
import { Icon } from "@/ds/components";
import { money, unitCost, units } from "@/lib/format";
import type { ProductBids } from "./types";

/**
 * The product's identity strip — who it is, what it costs today, and the tabs.
 *
 * ## Why this carries ONE image and not a gallery
 *
 * It mounted the full `ProductGallery` and the height depended on the product.
 * Measured on two styles: a 2-colourway style put its chips in 1 row (28px)
 * while an 8-colourway style wrapped them into **5 rows (156px)**, so the art
 * column ran 187px on one product and 210px on another, and the gap above the
 * tabs went from 50px to 73px. The data says that is the norm, not the edge:
 * **12 of 82 styles have 6-8 colourways and 64 of 82 have more than 8 images**
 * (max 41). A header hosting a gallery cannot have a predictable height, and
 * 58% of a 900px viewport was being spent before the first vendor row.
 *
 * So: one fixed-size thumbnail with a count, identical on all 82 products, and
 * the whole gallery one click away in the style drawer at full size — bigger
 * than this header could ever show it.
 */
export function ProductHeader({
  data,
  bidCount,
  backHref,
  backLabel,
  onOpenGallery,
}: {
  data: ProductBids;
  bidCount: number;
  /**
   * Where the breadcrumb returns to, WITH the filters that were applied when
   * the user left. Award Summary keeps its filters in the URL, so this is that
   * URL — clicking a product and coming back no longer drops seven filters and
   * the view toggle.
   */
  backHref: string;
  backLabel: string;
  /** Opens the style drawer, which holds the real gallery. */
  onOpenGallery: () => void;
}) {
  const s = data.style;
  const baseline = s.baselineLanded ?? s.baselineFob ?? 0;
  const annual = (s.planUnits ?? 0) * baseline;
  const imageCount = s.images.length;

  return (
    <div className="pd-head">
      <div className="pd-head-main">
        {/* One level in, so the trail ends at the parent and does not restate
            the page's own title. */}
        <nav className="pd-trail" aria-label="Breadcrumb">
          <Link href={backHref}>{backLabel}</Link>
          <Icon name="chevron_right" size="sm" />
          <span className="id">{s.styleNumber}</span>
        </nav>

        <div className="pd-id">
          {imageCount ? (
            /* A button, not decoration — it opens the gallery. Fixed 88px so
               the header is the same height on every product. */
            <button
              className="pd-thumb"
              onClick={onOpenGallery}
              aria-label={`View all ${imageCount} images and ${s.colourways.length} colourways`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.images[0]} alt="" />
              <span className="pd-thumb-n">
                <Icon name="camera" size="sm" />
                {imageCount}
              </span>
            </button>
          ) : null}

          <div className="pd-id-text">
            <h1 className="pd-title">{s.name}</h1>
            <div className="pd-meta">
              {[s.division, s.department, s.subDepartment]
                .filter(Boolean)
                .join(" · ")}
              {s.colourways.length > 1 ? (
                <>
                  {" · "}
                  <button className="pd-cw-link" onClick={onOpenGallery}>
                    {s.colourways.length} colourways
                  </button>
                </>
              ) : null}
            </div>
          </div>

          {/* The four numbers that frame every decision. A grid of EQUAL tracks:
              `max-content` sized each to its own content and left 583px of dead
              space at the trailing end — the same defect the RFP header had. */}
          <dl className="pd-facts">
            <div className="pd-fact">
              <dt>Plan units</dt>
              <dd>
                {units(s.planUnits)}
                <span className="u">/yr</span>
              </dd>
            </div>
            <div className="pd-fact">
              <dt>Baseline landed</dt>
              <dd>{unitCost(baseline)}</dd>
            </div>
            <div className="pd-fact">
              <dt>Annual value</dt>
              <dd>{money(annual)}</dd>
            </div>
            <div className="pd-fact">
              <dt>Bids in</dt>
              <dd>{bidCount}</dd>
            </div>
          </dl>
        </div>

      </div>
    </div>
  );
}
