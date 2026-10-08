"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { SelBarMenu } from "@/components/SelBarMenu";
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
  onReviewVariations,
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
  /** Opens the review modal. Absent on screens with no variation context. */
  onReviewVariations?: () => void;
}) {
  const router = useRouter();


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

      {/* Aravind's reworked bar: Clear selection, then ONE primary
          menu holding every action on the selection. */}
      <div className="acts">
        <button className="btn btn--ghost" onClick={onClear}>
          Clear selection
        </button>
        <SelBarMenu
          label="Create"
          items={[
            { label: "Create RFP", icon: "arrow_right", onSelect: () => router.push("/rfps/new") },
            // The path for "all of it except King": Create RFP sends every
            // variation; this opens the review first.
            ...(onReviewVariations
              ? [{ label: "Review variation level", icon: "list" as const, onSelect: onReviewVariations }]
              : []),
            ...(onSaveAsSet
              ? [{ label: "Save as style set", icon: "bedding" as const, onSelect: onSaveAsSet }]
              : []),
          ]}
        />
      </div>
    </div>
  );
}
