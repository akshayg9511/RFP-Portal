"use client";

import * as React from "react";

/**
 * ONE hover card for every cost cell on Bid summary (14 — landed breakdown).
 *
 * The grid scrolls inside an overflow container, so a tooltip positioned
 * inside a cell is clipped at the grid's edge. The card is rendered once, at
 * page level, position: fixed against the hovered cell's rect.
 */

type Tip = { node: React.ReactNode; top: number; left: number; above: boolean };
type Ctx = { show: (el: HTMLElement, node: React.ReactNode) => void; hide: () => void };

const TipContext = React.createContext<Ctx>({ show: () => {}, hide: () => {} });

const CARD_H = 190;

export function CostTipProvider({ children }: { children: React.ReactNode }) {
  const [tip, setTip] = React.useState<Tip | null>(null);

  const ctx = React.useMemo<Ctx>(
    () => ({
      show(el, node) {
        const r = el.getBoundingClientRect();
        const above = r.bottom + 8 + CARD_H > window.innerHeight;
        setTip({ node, top: above ? r.top - 8 : r.bottom + 8, left: r.right, above });
      },
      hide: () => setTip(null),
    }),
    [],
  );

  // A scrolled grid would leave the card floating over the wrong cell.
  React.useEffect(() => {
    if (!tip) return;
    const hide = () => setTip(null);
    window.addEventListener("scroll", hide, true);
    return () => window.removeEventListener("scroll", hide, true);
  }, [tip]);

  return (
    <TipContext.Provider value={ctx}>
      {children}
      {tip ? (
        <div
          className={`bs-tip${tip.above ? " is-above" : ""}`}
          role="tooltip"
          style={{ top: tip.top, left: tip.left }}
        >
          {tip.node}
        </div>
      ) : null}
    </TipContext.Provider>
  );
}

/** Wraps a cell's value; hover or keyboard focus shows `tip`. */
export function TipTarget({
  tip,
  children,
  className,
}: {
  tip: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const { show, hide } = React.useContext(TipContext);
  return (
    <span
      className={`bs-tip-t${className ? ` ${className}` : ""}`}
      tabIndex={0}
      onMouseEnter={(e) => show(e.currentTarget, tip)}
      onMouseLeave={hide}
      onFocus={(e) => show(e.currentTarget, tip)}
      onBlur={hide}
      // The row opens the drawer on click; reading a tip should not.
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </span>
  );
}
