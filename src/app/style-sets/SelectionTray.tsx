"use client";

import { useRouter } from "next/navigation";
import { Icon } from "@/ds/components";
import { money } from "@/lib/format";

/**
 * The persistent selection tray — `.sel-bar`, the one floating surface in the
 * system that inverts.
 *
 * It carries the running count AND the number of distinct templates the
 * selection spans, which is what foreshadows the split into multiple RFPs
 * before the user reaches the confirm step.
 */
export function SelectionTray({
  count,
  annualSpend,
  templateCount,
  onClear,
}: {
  count: number;
  annualSpend: number;
  templateCount: number;
  onClear: () => void;
}) {
  const router = useRouter();

  if (count === 0) return null;

  return (
    <div className="sel-bar fixed">
      <span className="cnt">
        {count} {count === 1 ? "product" : "products"} · {money(annualSpend)} annual
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
        <button
          className="btn btn--primary"
          onClick={() => router.push("/rfps/new")}
        >
          <Icon name="arrow_right" />
          Create RFP
        </button>
      </div>
    </div>
  );
}
