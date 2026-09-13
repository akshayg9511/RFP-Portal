"use client";

import * as React from "react";

/**
 * The selection, shared across screens.
 *
 * The Build Doc calls the tray persistent: it survives moving between style
 * sets and carries through to RFP creation. So it lives above the route rather
 * than in a page, and is mirrored to sessionStorage so a reload mid-demo does
 * not lose a selection built on stage.
 */

export type SelectedStyle = {
  id: string;
  styleNumber: string;
  name: string;
  division: string;
  department: string;
  annualSpend: number;
};

type SelectionContext = {
  selected: Map<string, SelectedStyle>;
  isSelected: (id: string) => boolean;
  toggle: (style: SelectedStyle) => void;
  addMany: (styles: SelectedStyle[]) => void;
  clear: () => void;
  count: number;
  annualSpend: number;
  /** Distinct division+department pairs — how many RFPs this becomes. */
  templateCount: number;
};

const Context = React.createContext<SelectionContext | null>(null);
const STORAGE_KEY = "procura.selection";

export function SelectionProvider({ children }: { children: React.ReactNode }) {
  const [selected, setSelected] = React.useState<Map<string, SelectedStyle>>(
    new Map(),
  );

  // Restore after mount, never during render — the server has no
  // sessionStorage and hydration would mismatch.
  React.useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) setSelected(new Map(JSON.parse(raw) as [string, SelectedStyle][]));
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
      toggle: (style) =>
        setSelected((prev) => {
          const next = new Map(prev);
          if (next.has(style.id)) next.delete(style.id);
          else next.set(style.id, style);
          return next;
        }),
      addMany: (styles) =>
        setSelected((prev) => {
          const next = new Map(prev);
          // If every one is already in, the action reads as "deselect all".
          const allIn = styles.every((s) => next.has(s.id));
          for (const s of styles) {
            if (allIn) next.delete(s.id);
            else next.set(s.id, s);
          }
          return next;
        }),
      clear: () => setSelected(new Map()),
      count: selected.size,
      annualSpend: list.reduce((total, s) => total + s.annualSpend, 0),
      templateCount: new Set(list.map((s) => `${s.division}|${s.department}`)).size,
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
