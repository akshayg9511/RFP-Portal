"use client";

import * as React from "react";
import { units } from "@/lib/format";
import type { Invitation, Style } from "./ProductsTab";

/**
 * What this RFP is sending out — at the TOP of the page, not behind a tab.
 *
 * Akshay, 8 Oct (from Navneet's feedback): "Product should not be a tab. It
 * should be merged with the top details as to what all products are added,
 * along with variation levels." One row per product: its variations as
 * chips, plan units, and once issued, how many vendors are quoting it and
 * how many have bid.
 */
export function ProductsSummary({
  styles,
  invitations,
  issued,
}: {
  styles: Style[];
  invitations: Invitation[];
  issued: boolean;
}) {
  return (
    <section className="card rd-products" aria-labelledby="rd-products-h">
      <div className="card-h">
        <div className="ttl" id="rd-products-h">
          Products in this RFP <span className="vl-count">{styles.length}</span>
        </div>
      </div>
      <ul className="rd-plist">
        {styles.map((s) => {
          const quoting = invitations.filter((i) => i.styleIds.includes(s.id)).length;
          const bids = invitations.filter((i) =>
            i.quotes.some((q) => q.styleId === s.id && q.status === "SUBMITTED"),
          ).length;
          const variations = s.variations ?? [];
          return (
            <li className="rd-prow" key={s.id}>
              {s.heroImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="aw-thumb" src={s.heroImage} alt="" loading="lazy" />
              ) : (
                <span className="aw-thumb aw-thumb--empty" />
              )}
              <span className="rd-pid">
                <span className="rd-pname">
                  <span className="id">{s.styleNumber}</span> {s.name}
                </span>
                <span className="rd-pchips">
                  {variations.length > 1 ? (
                    variations.map((v) => (
                      <span className="rd-chip" key={v.id}>
                        {v.label}
                      </span>
                    ))
                  ) : (
                    <span className="rd-chip">Whole product</span>
                  )}
                </span>
              </span>
              <span className="rd-pmeta">
                {s.planUnits ? `${units(s.planUnits)} units/yr` : "—"}
              </span>
              <span className="rd-pmeta">
                {issued
                  ? `${bids} of ${quoting} vendor${quoting === 1 ? "" : "s"} bid`
                  : `${quoting} vendor${quoting === 1 ? "" : "s"} nominated`}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
