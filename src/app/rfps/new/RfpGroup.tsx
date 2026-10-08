"use client";

import * as React from "react";
import { Badge, Checkbox, Icon } from "@/ds/components";
import { money, unitCost, units } from "@/lib/format";

export type SplitGroup = {
  templateId: string;
  templateName: string;
  resolutionPath: string;
  suggestedName: string;
  styleCount: number;
  annualSpend: number;
  styles: {
    id: string;
    styleNumber: string;
    name: string;
    subDepartment: string;
    planUnits: number | null;
    baselineFob: number | null;
    hasBaseline: boolean;
    hasCleanSheet: boolean;
    variationLevel?: string;
    /** The bid groups this product would go out on. Empty at STYLE grain. */
    variations?: {
      id: string;
      label: string;
      variationIds: string[];
      planUnits: number;
      baselineFob: number | null;
    }[];
  }[];
};

/**
 * One resulting RFP, collapsed.
 *
 * The previous version showed every product of every RFP at once — two full
 * tables and two blocks of helper text before the user could see what they
 * were confirming. The face now carries the four facts that matter (name,
 * products, spend, readiness) and the products are one click away.
 */
export function RfpGroup({
  group,
  name,
  onNameChange,
  instructions,
  onInstructionsChange,
  defaultOpen,
  dropped,
  onToggleVariation,
  children,
}: {
  children?: React.ReactNode;
  group: SplitGroup;
  name: string;
  onNameChange: (value: string) => void;
  instructions: string;
  onInstructionsChange: (value: string) => void;
  defaultOpen?: boolean;
  /**
   * Variations the user has DESELECTED, by styleId. Tracking exclusions
   * rather than inclusions means a product arrives fully included by
   * default, which is what the catalog selection already decided — Aravind
   * was explicit that nobody should have to re-pick.
   */
  dropped: Record<string, string[]>;
  onToggleVariation: (styleId: string, variationId: string) => void;
}) {
  const [open, setOpen] = React.useState(defaultOpen ?? false);
  // One product expanded at a time, as on the catalog.
  const [openStyle, setOpenStyle] = React.useState<string | null>(null);

  const notReady = group.styles.filter((s) => !s.hasBaseline).length;
  const noCleanSheet = group.styles.filter(
    (s) => s.hasBaseline && !s.hasCleanSheet,
  ).length;

  return (
    <div className="card rfp-group">
      <div className="card-b">
        <div className="rfp-group-head">
          <div className="rfp-group-id">
            <Icon name="invoice" />
            <div>
              <div className="rfp-group-template">{group.templateName}</div>
              <div className="rfp-group-path">
                Template resolves {group.resolutionPath}
              </div>
            </div>
          </div>

          <dl className="rfp-group-stats">
            <div>
              <dt>Products</dt>
              <dd>{units(group.styleCount)}</dd>
            </div>
            <div>
              <dt>Annual spend</dt>
              <dd>{money(group.annualSpend)}</dd>
            </div>
            <div>
              <dt>Readiness</dt>
              <dd>
                {notReady > 0 ? (
                  <Badge tone="danger">{notReady} missing baseline</Badge>
                ) : noCleanSheet > 0 ? (
                  <Badge tone="warning">{noCleanSheet} no clean sheet</Badge>
                ) : (
                  <Badge tone="success">All ready</Badge>
                )}
              </dd>
            </div>
          </dl>
        </div>

        <div className="field rfp-group-name">
          <label className="lbl" htmlFor={`name-${group.templateId}`}>
            RFP name
          </label>
          <div className="control">
            <input
              id={`name-${group.templateId}`}
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
            />
          </div>
        </div>

        <div className="field">
          <label className="lbl" htmlFor={`inst-${group.templateId}`}>
            Instructions to this vendor group
          </label>
          <div className="control">
            <textarea
              id={`inst-${group.templateId}`}
              rows={2}
              value={instructions}
              onChange={(e) => onInstructionsChange(e.target.value)}
              placeholder="All lead times must assume Q1 shipping. Quote in USD only."
            />
          </div>
        </div>

        {/* Nomination slot (UX v2): optional vendors for this RFP. */}
        {children}
      </div>

      <div className={open ? "acc-item open" : "acc-item"}>
        <button
          className="acc-h"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Hide" : "Show"} {group.styleCount} products
          <Icon name="chevron_down" className="chev" />
        </button>

        <div className="acc-b">
          <div className="data-grid-surface">
            <table className="data-grid">
              <thead>
                <tr>
                  <th>Style</th>
                  <th>Sub-department</th>
                  <th className="num">Plan units</th>
                  <th className="num">Baseline FOB</th>
                  <th>Readiness</th>
                </tr>
              </thead>
              <tbody>
                {group.styles.map((style) => {
                  const groups = style.variations ?? [];
                  const expandable = groups.length > 1;
                  const isOpen = openStyle === style.id;
                  // Absent from the map = every variation is going out, which
                  // is what the catalog selection means when it picked none.
                  const excluded = dropped[style.id] ?? [];
                  const going = groups.length - excluded.length;

                  return (
                    <React.Fragment key={style.id}>
                      <tr>
                        <td>
                          {expandable ? (
                            <button
                              className="pc-chev"
                              onClick={() =>
                                setOpenStyle(isOpen ? null : style.id)
                              }
                              aria-expanded={isOpen}
                              aria-label={`${isOpen ? "Hide" : "Show"} variations of ${style.name}`}
                            >
                              <Icon
                                name={isOpen ? "chevron_up" : "chevron_down"}
                                size="sm"
                              />
                            </button>
                          ) : (
                            <span className="pc-chev pc-chev--none" />
                          )}
                          <span className="id">{style.styleNumber}</span> ·{" "}
                          {style.name}
                          {expandable ? (
                            <span className="rg-var-count">
                              {going} of {groups.length}{" "}
                              {axisWord(style.variationLevel)}
                            </span>
                          ) : null}
                        </td>
                        <td>{style.subDepartment}</td>
                        <td className="num">{units(style.planUnits)}</td>
                        <td className="num">{unitCost(style.baselineFob)}</td>
                        <td>
                          {!style.hasBaseline ? (
                            <Badge tone="danger">No baseline</Badge>
                          ) : !style.hasCleanSheet ? (
                            <Badge tone="warning">No clean sheet</Badge>
                          ) : (
                            <Badge tone="success">Ready</Badge>
                          )}
                        </td>
                      </tr>

                      {isOpen
                        ? groups.map((v) => {
                            const out = excluded.includes(v.id);
                            return (
                              <tr className="pc-var-row" key={v.id}>
                                <td>
                                  <span className="pc-var-box">
                                    <Checkbox
                                      checked={!out}
                                      onChange={() =>
                                        onToggleVariation(style.id, v.id)
                                      }
                                      aria-label={`Include ${v.label} of ${style.name}`}
                                    />
                                  </span>
                                  <span className="pc-var-label">
                                    {v.label}
                                  </span>
                                </td>
                                <td />
                                <td className="num">{units(v.planUnits)}</td>
                                <td className="num">
                                  {unitCost(v.baselineFob)}
                                </td>
                                <td />
                              </tr>
                            );
                          })
                        : null}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

/** "sizes" / "colours", so the count reads as English. */
function axisWord(variationLevel?: string): string {
  if (variationLevel === "SIZE") return "sizes";
  if (variationLevel === "COLOUR") return "colours";
  if (variationLevel === "SKU") return "SKUs";
  return "variations";
}
