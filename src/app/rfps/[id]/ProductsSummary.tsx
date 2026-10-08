"use client";

import * as React from "react";
import { Icon } from "@/ds/components";
import { units } from "@/lib/format";
import type { Invitation, Style } from "./ProductsTab";

/**
 * What this RFP is sending out — at the TOP of the page, not behind a tab.
 *
 * Akshay, 8 Oct: "Product should not be a tab. It should be merged with the
 * top details as to what all products are added, along with variation
 * levels." And: "product list can be high, so make it scrollable."
 *
 * So the list scrolls inside a fixed-height surface with its header and
 * search held still, and the vendor section below it stays in reach however
 * many products the RFP carries. On a DRAFT the products are still being
 * decided: Add products sits in the header and each row can be removed.
 */
export function ProductsSummary({
  styles,
  invitations,
  issued,
  draft,
  onAdd,
  onRemove,
  busy,
}: {
  styles: Style[];
  invitations: Invitation[];
  issued: boolean;
  draft: boolean;
  onAdd?: () => void;
  onRemove?: (styleId: string) => void;
  busy?: boolean;
}) {
  const [query, setQuery] = React.useState("");
  const q = query.trim().toLowerCase();
  const rows = q
    ? styles.filter(
        (s) => s.styleNumber.toLowerCase().includes(q) || s.name.toLowerCase().includes(q),
      )
    : styles;
  // Search earns its place only once the list is long enough to scroll.
  const searchable = styles.length > 6;

  return (
    <section className="card rd-products" aria-labelledby="rd-products-h">
      <div className="card-h rd-products-h">
        <div className="ttl" id="rd-products-h">
          Products in this RFP <span className="vl-count">{styles.length}</span>
        </div>
        {searchable ? (
          <div className="control search sm rd-psearch">
            <Icon name="search" size="sm" />
            <input
              placeholder="Search products"
              aria-label="Search products in this RFP"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        ) : null}
        {draft && onAdd ? (
          <button type="button" className="btn btn--secondary sm" onClick={onAdd}>
            <Icon name="plus" size="sm" />
            Add products
          </button>
        ) : null}
      </div>
      <ul className="rd-plist" tabIndex={0} aria-label="Products">
        {rows.map((s) => {
          const quoting = invitations.filter((i) => i.styleIds.includes(s.id)).length;
          const bids = invitations.filter((i) =>
            i.quotes.some((x) => x.styleId === s.id && x.status === "SUBMITTED"),
          ).length;
          // What actually went out: the variations ON the RFP. Empty means the
          // whole product, which for a sized product is every variation.
          const variations = s.onRfp?.length ? s.onRfp : (s.variations ?? []);
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
                  : `${quoting} vendor${quoting === 1 ? "" : "s"}`}
              </span>
              {draft && onRemove ? (
                <button
                  type="button"
                  className="btn btn--ghost sm icon"
                  aria-label={`Remove ${s.styleNumber} from this RFP`}
                  disabled={busy || styles.length === 1}
                  onClick={() => onRemove(s.id)}
                >
                  <Icon name="close" size="sm" />
                </button>
              ) : null}
            </li>
          );
        })}
        {rows.length === 0 ? (
          <li className="rd-pempty">No products match “{query}”.</li>
        ) : null}
      </ul>
    </section>
  );
}
