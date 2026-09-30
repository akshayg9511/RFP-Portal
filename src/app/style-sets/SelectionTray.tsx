"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Icon, Menu, MenuItem } from "@/ds/components";
import { money } from "@/lib/format";

/**
 * The persistent selection tray — `.sel-bar`, the one floating surface in the
 * system that inverts.
 *
 * It carries the running count AND the number of distinct templates the
 * selection spans, which is what foreshadows the split into multiple RFPs
 * before the user reaches the confirm step.
 *
 * ACTIONS COLLAPSE INTO ONE GHOST MENU, which is the system's rule for this
 * pattern and which `QDS_LINT` enforces: "Every bulk action collapses into ONE
 * ghost menu at the trailing edge." A filled button here competes with the
 * commit on the screen behind it, and with two actions (Create RFP, Save as
 * style set) it also made two primaries on one screen.
 */
export function SelectionTray({
  count,
  skuCount = 0,
  annualSpend,
  templateCount,
  onClear,
  onSaveAsSet,
}: {
  count: number;
  /** Selected variations. 0 when everything is a whole-product pick. */
  skuCount?: number;
  annualSpend: number;
  templateCount: number;
  onClear: () => void;
  /**
   * Offered on the Product catalog, where grouping is the job. Omitted inside a
   * style set, where saving the members of a set as another set is a loop
   * nobody means to take.
   */
  onSaveAsSet?: () => void;
}) {
  const router = useRouter();
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

  /**
   * Reserve room for the tray on the scroll container while it is up.
   *
   * `.has-tray` has existed in the CSS since the tray shipped and was applied
   * by NOTHING — measured: the tray sits 52px tall over a list whose last rows
   * extend past it. Done here rather than in each of the three screens that
   * mount the tray, so a fourth cannot forget.
   */
  React.useEffect(() => {
    if (count === 0) return;
    const scroller = document.querySelector(".shell > .ct");
    if (!scroller) return;
    scroller.classList.add("has-tray");
    return () => scroller.classList.remove("has-tray");
  }, [count]);

  if (count === 0) return null;

  return (
    <div className="sel-bar fixed">
      <span className="cnt">
        {count} {count === 1 ? "product" : "products"}
        {/* SKUs only when variations were actually picked — on a style-grained
            selection the figure would just restate the product count. */}
        {skuCount > 0 ? ` · ${skuCount} SKU${skuCount === 1 ? "" : "s"}` : ""}
        {" · "}
        {money(annualSpend)} annual
        {templateCount > 1 ? (
          <>
            {" · "}
            <strong>{templateCount} templates</strong>
          </>
        ) : null}
      </span>

      <div className="acts">
        <button className="btn btn--ghost" onClick={onClear}>
          Clear
        </button>

        <div className="sel-menu-wrap" ref={wrap}>
          <button
            className="btn btn--ghost"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-haspopup="menu"
          >
            With {count} selected
            <Icon name={open ? "chevron_up" : "chevron_down"} size="sm" />
          </button>

          {open ? (
            <Menu className="sel-menu" aria-label="Actions for the selection">
              <MenuItem
                icon={<Icon name="arrow_right" size="sm" />}
                onClick={() => {
                  setOpen(false);
                  router.push("/rfps/new");
                }}
              >
                Create RFP
              </MenuItem>
              {onSaveAsSet ? (
                <MenuItem
                  icon={<Icon name="bedding" size="sm" />}
                  onClick={() => {
                    setOpen(false);
                    onSaveAsSet();
                  }}
                >
                  Save as style set
                </MenuItem>
              ) : null}
            </Menu>
          ) : null}
        </div>
      </div>
    </div>
  );
}
