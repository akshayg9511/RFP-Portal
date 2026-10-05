"use client";

import Link from "next/link";
import { Badge, Icon } from "@/ds/components";
import { useApi } from "@/lib/useApi";
import { percent, units } from "@/lib/format";
import { FacetSelect, facetsOf } from "@/components/FacetSelect";
import * as React from "react";

type RfpRow = {
  id: string;
  name: string;
  status: string;
  templateName: string;
  waveName: string;
  dueDate: string | null;
  styleCount: number;
  vendorCount: number;
  respondedCount: number;
  bidCount: number;
  stylesWithBids: number;
  /** Lowest bid vs baseline across products that have bids. Negative saves. */
  lowestVsBaseline: number | null;
  sourcingPartner: string | null;
  gm: string | null;
};

/**
 * DRAFT used to render with `tone: undefined`, which gives a Badge no fill —
 * so it read as plain text beside a filled ISSUED chip and looked like a
 * different kind of thing. Every state now carries a tone.
 */
const STATUS_TONE: Record<string, "success" | "info" | "warning" | undefined> = {
  DRAFT: "warning",
  ISSUED: "success",
  CLOSED: "info",
};

export default function RfpsPage() {
  const { data, loading, error } = useApi<RfpRow[]>("/api/rfps");

  /**
   * FILTER BY OWNER (H5).
   *
   * Akshay: "The RFP screen should have a filter by sourcing partner or a
   * filter by GM… so that sourcing partner and GM can function with
   * clarity." This list had NO filters at all, so net-new but small —
   * `FacetSelect` is already the convention on seven other call sites.
   */
  const [partner, setPartner] = React.useState("");
  const [gm, setGm] = React.useState("");
  const [status, setStatus] = React.useState("");

  const rows = React.useMemo(() => {
    return (data ?? []).filter(
      (r) =>
        (!partner || r.sourcingPartner === partner) &&
        (!gm || r.gm === gm) &&
        (!status || r.status === status),
    );
  }, [data, partner, gm, status]);

  /**
   * Facet counts EXCLUDE their own dimension, so picking one partner does
   * not make every other partner read (0) — you could then never see what
   * switching to them would give you. Same rule as /award.
   */
  const facets = React.useMemo(() => {
    const all = data ?? [];
    const without = (skip: "partner" | "gm" | "status") =>
      all.filter(
        (r) =>
          (skip === "partner" || !partner || r.sourcingPartner === partner) &&
          (skip === "gm" || !gm || r.gm === gm) &&
          (skip === "status" || !status || r.status === status),
      );
    return {
      partner: facetsOf(without("partner"), (r) => r.sourcingPartner),
      gm: facetsOf(without("gm"), (r) => r.gm),
      status: facetsOf(without("status"), (r) => r.status),
    };
  }, [data, partner, gm, status]);

  const filtered = partner || gm || status;

  return (
    <>
      <div className="page-hd">
        <h1>RFPs</h1>
        <div className="acts">
          <Link className="btn btn--primary" href="/style-sets">
            <Icon name="plus" />
            New RFP
          </Link>
        </div>
      </div>

      {/* A utility strip, so these stay GHOST however close they sit to the
          title row's primary. */}
      <div className="aw-filters">
        <FacetSelect
          label="Sourcing partner"
          value={partner}
          onChange={setPartner}
          options={facets.partner}
        />
        <FacetSelect label="GM" value={gm} onChange={setGm} options={facets.gm} />
        <FacetSelect
          label="Status"
          allLabel="Any status"
          value={status}
          onChange={setStatus}
          options={facets.status}
        />
        {filtered ? (
          <>
            <span className="rl-count">
              {rows.length} of {(data ?? []).length}
            </span>
            <button
              className="btn btn--ghost sm"
              onClick={() => {
                setPartner("");
                setGm("");
                setStatus("");
              }}
            >
              Clear
            </button>
          </>
        ) : null}
      </div>

      {error ? (
        <div className="bar bar--danger">
          <Icon name="alert_triangle" />
          <div>
            <strong>RFPs could not be loaded.</strong> {error}
          </div>
        </div>
      ) : null}

      <div className="data-grid-surface">
        <table className="data-grid">
          {/* Column ORDER carries the spacing. `Responses` used to sit at
              position 5, left-aligned, splitting the right-aligned numeric run
              (Products / Vendors | Responses | Bids / Lowest) in half — so no
              two numbers shared a right edge and the row read as skewed. The
              three counts now run together against one edge, and Responses —
              the only wide, left-aligned, non-numeric measure — ends the row
              beside the bar it owns. */}
          <colgroup>
            <col style={{ width: "31%" }} />
            <col style={{ width: "11%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "8%" }} />
            {/* 15%, not 13% — "Lowest vs baseline" wrapped to two lines and
                made the header row taller than any body row. */}
            <col style={{ width: "17%" }} />
            <col style={{ width: "15%" }} />
          </colgroup>
          <thead>
            <tr>
              <th>RFP</th>
              <th>Status</th>
              <th className="num">Products</th>
              <th className="num">Vendors</th>
              <th className="num">Bids</th>
              <th className="num">Lowest vs baseline</th>
              <th>Responses</th>
            </tr>
          </thead>
          <tbody>
            {loading
              ? [0, 1, 2, 3].map((i) => (
                  <tr key={i}>
                    {[0, 1, 2, 3, 4, 5, 6].map((c) => (
                      <td key={c}>
                        <div className="sk" style={{ blockSize: 14 }} />
                      </td>
                    ))}
                  </tr>
                ))
              : rows.map((rfp) => {
                  const share = rfp.vendorCount
                    ? rfp.respondedCount / rfp.vendorCount
                    : 0;

                  return (
                    <tr key={rfp.id}>
                      <td>
                        <Link className="rl-name" href={`/rfps/${rfp.id}`}>
                          {rfp.name}
                        </Link>
                        <span className="rl-sub">
                          {/* No round. Rounds were replaced by the status
                              ladder (H1) — negotiation is repeatable, so a
                              single number could not describe where a vendor
                              had got to. domain/bidStatus.ts owns it now. */}
                          {rfp.templateName}
                        </span>
                      </td>
                      <td>
                        <Badge tone={STATUS_TONE[rfp.status]}>{rfp.status}</Badge>
                      </td>
                      <td className="num">
                        {units(rfp.styleCount)}
                        {rfp.stylesWithBids ? (
                          <span className="rl-sub">
                            {rfp.stylesWithBids} bid
                          </span>
                        ) : null}
                      </td>
                      <td className="num">{units(rfp.vendorCount)}</td>
                      <td className="num">
                        {rfp.bidCount || <span className="rl-none">—</span>}
                      </td>
                      <td className="num">
                        {/* FOB against FOB. Negative is a saving. */}
                        {rfp.lowestVsBaseline === null ? (
                          <span className="rl-none">—</span>
                        ) : (
                          <span
                            className={
                              rfp.lowestVsBaseline < 0 ? "rl-save" : "rl-rise"
                            }
                          >
                            {percent(rfp.lowestVsBaseline)}
                          </span>
                        )}
                      </td>
                      <td>
                        {/* A DRAFT has sent nothing, so a 0% bar would imply a
                            problem where there is only work not yet started. */}
                        {rfp.status === "DRAFT" ? (
                          <span className="rl-none">not issued</span>
                        ) : rfp.vendorCount === 0 ? (
                          <span className="rl-none">no vendors</span>
                        ) : (
                          <span className="rl-resp">
                            <span className="rl-bar">
                              <span style={{ inlineSize: percent(share, 0) }} />
                            </span>
                            <span className="rl-resp-k">
                              {rfp.respondedCount} of {rfp.vendorCount}
                            </span>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
          </tbody>
        </table>

        {!loading && data && data.length === 0 ? (
          <div className="empty compact">
            <span className="glyph">
              <Icon name="invoice" size="lg" />
            </span>
            <div className="ttl">No RFPs yet</div>
            <div className="desc">
              Select products from a style set, and they become one RFP per
              quotation template.
            </div>
            <div className="acts">
              <Link className="btn btn--secondary" href="/style-sets">
                Browse style sets
              </Link>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
