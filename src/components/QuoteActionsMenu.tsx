"use client";

import * as React from "react";
import { Icon } from "@/ds/components";

/**
 * Everything secondary on the quote form, behind one ghost menu.
 *
 * Akshay, 5 Oct: "couple 5 option into 1 or 2 or max 3 option and within
 * option add dropdowns."
 *
 * The row was Withdraw · Copy to all · Save draft · Submit this one · Submit
 * all. The design system's rule is that bulk actions collapse into ONE ghost
 * menu at the trailing edge and a screen carries one primary — this row had
 * five controls and two of them were submits.
 *
 * Withdraw sits under a `.menu-label` of its own and is LAST, which is how
 * the system marks a destructive item: order plus the danger foreground, no
 * bare divider.
 */
export function QuoteActionsMenu({
  canEdit,
  canWithdraw,
  hasVariants,
  busy,
  onCopyAll,
  onSaveDraft,
  onWithdraw,
}: {
  canEdit: boolean;
  canWithdraw: boolean;
  /** Copy-to-all is meaningless on a single-variant product. */
  hasVariants: boolean;
  busy?: boolean;
  onCopyAll: () => void;
  onSaveDraft: () => void;
  onWithdraw: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const wrap = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrap.current && !wrap.current.contains(e.target as Node)) {
        setOpen(false);
      }
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

  function run(fn: () => void) {
    setOpen(false);
    fn();
  }

  return (
    <div className="qa-wrap" ref={wrap}>
      <button
        className="btn btn--ghost"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy}
        onClick={() => setOpen((v) => !v)}
      >
        More
        <Icon name="chevron_down" size="sm" />
      </button>

      {open ? (
        <div className="qa-menu" role="menu">
          {canEdit ? (
            <>
              <button
                className="menu-item"
                role="menuitem"
                onClick={() => run(onSaveDraft)}
              >
                Save draft
              </button>
              {hasVariants ? (
                <button
                  className="menu-item"
                  role="menuitem"
                  onClick={() => run(onCopyAll)}
                >
                  Copy this variation to all others
                </button>
              ) : null}
            </>
          ) : null}

          {canWithdraw ? (
            <>
              {/* The system's break is a LABELLED group, never a bare
                  divider — and a destructive item is marked by being last. */}
              <div className="menu-label">Stop quoting</div>
              <button
                className="menu-item qa-danger"
                role="menuitem"
                onClick={() => run(onWithdraw)}
              >
                Withdraw from this product
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
