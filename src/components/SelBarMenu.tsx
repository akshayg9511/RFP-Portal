"use client";

import * as React from "react";
import { Icon, Menu, MenuItem } from "@/ds/components";

/**
 * The one action menu on a floating selection bar (Aravind's reworked
 * selection bar, Open Questions 02: "5 Products Selected · $24.1M annual |
 * Clear selection | Create ▾"). Every bulk action collapses into this single
 * trigger, opening upward from the bar. A disabled item stays visible with
 * its reason, so a missing action is never a mystery.
 */
export type SelBarItem = {
  label: string;
  onSelect: () => void;
  icon?: React.ComponentProps<typeof Icon>["name"];
  disabled?: boolean;
  danger?: boolean;
};

export function SelBarMenu({
  label,
  items,
  primary = true,
  busy,
}: {
  label: string;
  items: SelBarItem[];
  /** The bar's commit. Filled accent, as in the mock; false gives a ghost. */
  primary?: boolean;
  busy?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const wrap = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="sel-menu-wrap" ref={wrap}>
      <button
        type="button"
        className={primary ? "btn btn--primary sm" : "btn btn--ghost"}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={busy}
      >
        {label}
        <Icon name={open ? "chevron_up" : "chevron_down"} size="sm" />
      </button>
      {open ? (
        <Menu className="sel-menu" aria-label={label}>
          {items.map((it) => (
            <MenuItem
              key={it.label}
              icon={it.icon ? <Icon name={it.icon} size="sm" /> : undefined}
              disabled={it.disabled}
              danger={it.danger}
              onSelect={() => {
                setOpen(false);
                it.onSelect();
              }}
            >
              {it.label}
            </MenuItem>
          ))}
        </Menu>
      ) : null}
    </div>
  );
}
