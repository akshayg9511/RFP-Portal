"use client";

import * as React from "react";
import { Icon, Menu, MenuItem } from "@/ds/components";

/**
 * The variation switcher — a GHOST-button dropdown beside a title.
 *
 * Ghost rather than secondary, on Aravind's steer: it should read as
 * "information and an interaction, as opposed to just an interaction". A
 * secondary button beside a title claims to be the screen's runner-up
 * action, which this is not — it is a lens on what is already there.
 *
 * There is NO "select a variation first" gate. The caller defaults to the
 * first variation in sort order, because asking someone to choose before
 * they can see anything is, in Aravind's words, a bad user experience.
 *
 * Absent at STYLE grain. A one-item dropdown reads as broken, so the caller
 * renders nothing rather than a dropdown that cannot change.
 */

export type SwitchableVariation = {
  id: string;
  label: string;
};

export function VariationSwitcher({
  variations,
  value,
  onChange,
  /** "Size", "Colour" — names the axis so the control explains itself. */
  axisLabel,
}: {
  variations: SwitchableVariation[];
  value: string | null;
  onChange: (variationId: string) => void;
  axisLabel?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const wrap = React.useRef<HTMLSpanElement>(null);

  // Close on an outside click or Escape. Both, because a dropdown that only
  // closes on a second click on the trigger traps keyboard users.
  React.useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // One option is not a choice.
  if (variations.length < 2) return null;

  const current = variations.find((v) => v.id === value) ?? variations[0];

  return (
    <span className="vsw" ref={wrap}>
      <button
        className="btn btn--ghost sm vsw-btn"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Change ${axisLabel?.toLowerCase() ?? "variation"}`}
      >
        {axisLabel ? <span className="vsw-axis">{axisLabel}</span> : null}
        {current.label}
        <Icon name={open ? "chevron_up" : "chevron_down"} size="sm" />
      </button>

      {open ? (
        <Menu className="vsw-menu">
          {variations.map((v, i) => (
            <MenuItem
              key={v.id}
              tabIndex={i === 0 ? 0 : -1}
              trail={v.id === current.id ? <Icon name="check" size="sm" /> : undefined}
              onSelect={() => {
                onChange(v.id);
                setOpen(false);
              }}
            >
              {v.label}
            </MenuItem>
          ))}
        </Menu>
      ) : null}
    </span>
  );
}
