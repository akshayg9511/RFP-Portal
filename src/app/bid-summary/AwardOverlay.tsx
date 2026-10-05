"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Icon } from "@/ds/components";
import { ProductAward } from "@/app/products/[styleId]/award/page";

/**
 * ALLOCATE, WITHOUT LEAVING BID SUMMARY (5 Oct).
 *
 * Akshay: "We can have everything that is there in the award summary detail
 * page because you would like to compare the bids, allocate strategy, and
 * everything… a single point of view to play around with the award summary
 * from the bid summary itself."
 *
 * So this hosts the product award page ITSELF — Compare bids · Allocate ·
 * Strategies and the full footer — not a reduced copy. A second allocation
 * surface would be a second place for the 100% rule to drift.
 *
 * A full-height sheet over a scrim rather than a drawer: the award page is a
 * three-tab page with a pinned footer, which does not fit 640px (that is why
 * it stopped being a drawer in A5), and SideDrawer cannot nest (T11).
 *
 * It sits at `--z-overlay`, one rung BELOW `--z-modal`, so the product's own
 * gallery modal still opens above it.
 */
export function AwardOverlay({
  styleId,
  variationId,
  title,
  fullPageHref,
  closeHref,
  onSelectVariation,
  onClose,
  onChanged,
}: {
  styleId: string | null;
  variationId: string | null;
  title: string;
  /** The standalone page, carrying `back=` so its breadcrumb returns here. */
  fullPageHref: string;
  /** Bid summary as it stands underneath — the sheet's breadcrumb target. */
  closeHref: string;
  onSelectVariation: (id: string | null) => void;
  onClose: () => void;
  /** After any save — the grid behind refreshes its allocation column. */
  onChanged: () => void;
}) {
  const sheet = React.useRef<HTMLDivElement>(null);
  // Portals need document.body, which does not exist during prerender.
  const mounted = React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const open = styleId !== null;

  React.useEffect(() => {
    if (!open) return;
    const restoreTo = document.activeElement as HTMLElement | null;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    sheet.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      // A modal opened FROM the sheet (the product gallery) owns Escape
      // while it is up — closing both at once loses the allocation context.
      const others = [...document.querySelectorAll('[aria-modal="true"]')].filter(
        (el) => el !== sheet.current,
      );
      if (others.length) return;
      onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = overflow;
      restoreTo?.focus?.();
    };
  }, [open, onClose]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="scrim app-scrim ao-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={sheet}
        className="ao-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <div className="ao-head">
          <span className="ao-title">{title}</span>
          <Link className="btn btn--ghost sm" href={fullPageHref}>
            Open full page
            <Icon name="external" size="sm" />
          </Link>
          <button
            type="button"
            className="x"
            aria-label="Close and return to Bid summary"
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </div>
        <div className="ao-body">
          {/* Keyed on the product so switching products discards the
              previous one's unsaved inputs instead of carrying them over. */}
          <ProductAward
            key={styleId}
            styleId={styleId}
            variationParam={variationId}
            onSelectVariation={onSelectVariation}
            backHref={closeHref}
            backLabel="Bid summary"
            onAwarded={() => {
              onChanged();
              onClose();
            }}
            onChanged={onChanged}
            embedded
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
