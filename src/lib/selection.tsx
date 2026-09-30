"use client";

import * as React from "react";
import * as ops from "./selectionOps";

/**
 * The selection, shared across screens.
 *
 * The Build Doc calls the tray persistent: it survives moving between style
 * sets and carries through to RFP creation. So it lives above the route rather
 * than in a page, and is mirrored to sessionStorage so a reload mid-demo does
 * not lose a selection built on stage.
 */

/** Re-exported so the five existing import sites keep working unchanged. */
export type { SelectedStyle } from "./selectionOps";
type SelectedStyle = ops.SelectedStyle;

type SelectionContext = {
  selected: Map<string, SelectedStyle>;
  isSelected: (id: string) => boolean;
  toggle: (style: SelectedStyle) => void;
  addMany: (styles: SelectedStyle[]) => void;
  clear: () => void;
  /**
   * PRODUCTS, not variations — deliberately unchanged.
   *
   * The tray copy says "N products", `templateCount` counts product
   * attributes, and SaveAsSetDialog reads it. Redefining this to mean SKUs
   * would silently break three consumers, so the SKU figure is its own
   * field.
   */
  count: number;
  /** Selected variations across every product. 0 when all are whole-product. */
  skuCount: number;
  annualSpend: number;
  /** Distinct division+department pairs — how many RFPs this becomes. */
  templateCount: number;
  /** Tick or untick ONE variation, leaving the rest of the product alone. */
  toggleVariation: (
    style: SelectedStyle,
    variationId: string,
    variationTotal?: number,
  ) => void;
  /** Tick every variation of a product; toggles off when all are already in. */
  selectAllVariations: (style: SelectedStyle, variationIds: string[]) => void;
  /** Some but not all of a product's variations — drives the mixed checkbox. */
  isPartial: (id: string) => boolean;
  /** Which variations are ticked, for rendering the child rows. */
  variationsOf: (id: string) => string[];
};

const Context = React.createContext<SelectionContext | null>(null);
const STORAGE_KEY = "procura.selection";

export function SelectionProvider({ children }: { children: React.ReactNode }) {
  const [selected, setSelected] = React.useState<Map<string, SelectedStyle>>(
    new Map(),
  );

  // Restore after mount, never during render — the server has no
  // sessionStorage, so reading it during render would hydrate a different
  // tree than the server sent.
  //
  // This trips `react-hooks/set-state-in-effect`, and it did before this
  // change too. Deriving during render instead was tried and is WORSE:
  // reassigning the state variable defeats React's memoization analysis and
  // turned 2 errors into 8. A hydration-safe read genuinely needs the mount
  // boundary, so the rule is suppressed with its reason rather than worked
  // around.
  React.useEffect(() => {
    try {
      const restored = ops.restore(sessionStorage.getItem(STORAGE_KEY));
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (restored.size) setSelected(restored);
    } catch {
      // A private window or blocked storage is not an error worth showing.
    }
  }, []);

  React.useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...selected]));
    } catch {
      // Selection still works in memory.
    }
  }, [selected]);

  const value = React.useMemo<SelectionContext>(() => {
    const list = [...selected.values()];
    return {
      selected,
      isSelected: (id) => selected.has(id),
      toggle: (style) => setSelected((prev) => ops.toggleStyle(prev, style)),
      addMany: (styles) => setSelected((prev) => ops.addMany(prev, styles)),
      clear: () => setSelected(new Map()),
      count: selected.size,
      skuCount: ops.skuCount(selected),
      annualSpend: list.reduce((total, s) => total + s.annualSpend, 0),
      templateCount: new Set(list.map((s) => `${s.division}|${s.department}`)).size,

      // Ticking a variation on an unselected product SELECTS the product with
      // just that variation — the child row is a way into the selection, not
      // something that requires the parent first.
      toggleVariation: (style, variationId, variationTotal) =>
        setSelected((prev) =>
          ops.toggleVariation(prev, style, variationId, variationTotal),
        ),

      selectAllVariations: (style, variationIds) =>
        setSelected((prev) =>
          ops.selectAllVariations(prev, style, variationIds),
        ),

      isPartial: (id) => ops.isPartial(selected, id),

      variationsOf: (id) => selected.get(id)?.variationIds ?? [],
    };
  }, [selected]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useSelection(): SelectionContext {
  const context = React.useContext(Context);
  if (!context) {
    throw new Error("useSelection must be used inside SelectionProvider");
  }
  return context;
}
