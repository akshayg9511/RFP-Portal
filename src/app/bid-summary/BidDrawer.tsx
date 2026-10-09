"use client";

import * as React from "react";
import { Badge, Icon } from "@/ds/components";
import { SideDrawer } from "@/components/SideDrawer";
import { BidTabs } from "@/components/BidTabs";
import { useApi } from "@/lib/useApi";
import { money, unitCost, units } from "@/lib/format";
import type { ProductBids } from "@/app/products/[styleId]/types";
import { BUCKET_LABEL, BUCKET_ORDER } from "@/app/products/[styleId]/types";
import type { Basis, FlatRow } from "./types";

/**
 * The bid, in full, with the actions Quince takes on it — U6 / P6 / P7.
 *
 * Reuses what exists rather than forking it:
 *  - BidLifecycle for the status moves and the thread — the SAME control the
 *    RFP drawer uses (Akshay: "whatever statuses you have defined under RFP,
 *    the same can be added… you don't need to reinvent any status"). As a
 *    PANEL, because SideDrawer cannot nest (T11);
 *  - the product page's bids API for the cost buckets against the clean
 *    sheet, for exactly this variant.
 *
 * Previous / next walk the CURRENT filtered list, so a buyer can work a
 * queue of bids without closing the drawer.
 */
export function BidDrawer({
  row,
  siblings,
  onClose,
  onPrev,
  onNext,
  onSelect,
  onAllocate,
  onChanged,
}: {
  row: FlatRow | null;
  /** The same vendor's rows on the other variants of this product. */
  siblings: FlatRow[];
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onSelect: (row: FlatRow) => void;
  onAllocate: (group: FlatRow["group"]) => void;
  onChanged: () => void;
}) {
  return (
    <SideDrawer
      open={row !== null}
      onClose={onClose}
      title={row ? row.vendor.name : "Bid"}
      sub={
        row
          ? `${row.group.styleNumber} · ${row.group.name} · ${row.group.variationLabel}`
          : undefined
      }
      onPrev={onPrev}
      onNext={onNext}
      stepNoun="bid"
      // Allocate is a persistent footer, never scrolled out of reach
      // (Aravind, C34).
      footer={
        row ? (
          <button type="button" className="btn btn--primary" onClick={() => onAllocate(row.group)}>
            Allocate this variant
          </button>
        ) : undefined
      }
    >
      {row ? (
        // Keyed, so switching bid never shows the previous one's numbers.
        <DrawerBody key={row.rowKey} row={row} siblings={siblings} onSelect={onSelect} onChanged={onChanged} />
      ) : null}
    </SideDrawer>
  );
}

function DrawerBody({
  row,
  siblings,
  onSelect,
  onChanged,
}: {
  row: FlatRow;
  siblings: FlatRow[];
  onSelect: (row: FlatRow) => void;
  onChanged: () => void;
}) {
  const g = row.group;
  const p = row.price;

  return (
    // Status, Move, latest note and the Bid details · Comments tabs — the
    // same body as the RFP page's drawer (BidTabs; C31–C33).
    <BidTabs invitationId={row.invitationId} styleId={g.styleId} onChanged={onChanged}>
      {/* P7 — the same vendor on the other variants of this product. */}
      {siblings.length > 1 ? (
        <div className="section">
          <div className="hd">Variant</div>
          <div className="bd-vars" role="tablist" aria-label="Variants of this style">
            {siblings.map((s) => {
              const on = s.rowKey === row.rowKey;
              return (
                <button
                  key={s.rowKey}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  className={on ? "qv-tab on" : "qv-tab"}
                  onClick={() => onSelect(s)}
                >
                  <span className="qv-tab-l">{s.group.variationLabel}</span>
                  <span className="qv-tab-v">{s.price ? unitCost(s.price.bestCost) : "not bid"}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}


      {p ? (
        <>
          <FreightSection row={row} onChanged={onChanged} />
          <BucketsSection row={row} />
        </>
      ) : (
        <div className="section">
          <div className="empty compact">
            <span className="glyph"><Icon name="clock" size="lg" /></span>
            <div className="ttl">
              {row.notIssued ? "Not issued yet" : row.cannotBid ? "Not able to quote" : "No bid yet"}
            </div>
            <div className="desc">
              {row.notIssued
                ? "This RFP is still a draft, so the vendor has not been asked."
                : `${row.vendor.name} has not submitted a quote for ${g.variationLabel}.`}
            </div>
          </div>
        </div>
      )}

      <div className="section">
        <div className="hd">Terms and award</div>
        <dl className="fact-list">
          <dt>Lead time</dt><dd>{row.terms?.leadTimeDays ? `${row.terms.leadTimeDays} days` : "—"}</dd>
          <dt>Capacity</dt><dd>{row.terms?.capacity ? units(row.terms.capacity) : "—"}</dd>
          <dt>MOQ</dt><dd>{row.terms?.moq ? units(row.terms.moq) : "—"}</dd>
          <dt>Award</dt>
          <dd>
            {row.award ? `${Math.round(row.award.pct)}% · ${money(row.award.dollars)}` : "Not allocated"}
            {" · "}
            {g.allocated ? "variant fully allocated" : `variant ${Math.round(g.allocatedPct)}% allocated`}
          </dd>
          <dt>RFP</dt><dd>{row.rfp.name}</dd>
        </dl>
      </div>
    </BidTabs>
  );
}

/**
 * FREIGHT — P3. Automatic (the cheaper blend) by default; Quince may choose a
 * basis, and the automatic answer stays visible beside it. DDP needs both
 * modes quoted (decided 5 Oct), so it is disabled — with the reason — when
 * it does not exist.
 */
function FreightSection({ row, onChanged }: { row: FlatRow; onChanged: () => void }) {
  const p = row.price!;
  const g = row.group;
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  /**
   * OPTIMISTIC. The radio used to reflect only the server, so a click looked
   * ignored until the save and the refetch came back. It shows the choice at
   * once and rolls back only if the save fails.
   */
  const [pending, setPending] = React.useState<Basis | null | undefined>(undefined);
  const saved: Basis | null = p.overridden ? p.basis : null;
  const current = pending === undefined ? saved : pending;

  async function choose(basis: Basis | null) {
    setPending(basis);
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/bids/${row.invitationId}/${g.styleId}/freight`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ variationId: g.variationId, basis }),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b?.message ?? "Could not save");
      onChanged();
    } catch (e) {
      setPending(undefined);
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  const label = (b: Basis) => (b === "DDP_BLEND" ? "DDP" : "Quince-paid");
  const options: { value: Basis | null; text: string; disabled?: string }[] = [
    { value: null, text: `Automatic — ${label(p.automaticBasis)} is cheaper` },
    { value: "QUINCE_BLEND", text: "Quince-paid" },
    {
      value: "DDP_BLEND",
      text: "DDP",
      disabled: p.ddp ? undefined : "The vendor did not quote DDP for both air and ocean",
    },
  ];

  return (
    <div className="section">
      <div className="hd">Freight</div>
      <div className="bd-freight" role="radiogroup" aria-label="Freight basis">
        {options.map((o) => (
          <label key={o.text} className={o.disabled ? "bd-radio is-off" : "bd-radio"} title={o.disabled}>
            <input
              type="radio"
              name={`freight-${row.rowKey}`}
              checked={current === o.value}
              disabled={busy || Boolean(o.disabled)}
              onChange={() => choose(o.value)}
            />
            <span>{o.text}</span>
          </label>
        ))}
      </div>
      {error ? <p className="bd-err">{error}</p> : null}

      <table className="bd-chain">
        <thead>
          <tr><th /><th className="num">Ocean</th><th className="num">Air</th><th className="num">Blend</th></tr>
        </thead>
        <tbody>
          <tr className={p.basis === "QUINCE_BLEND" ? "is-used" : undefined}>
            <th>Quince-paid</th>
            <td className="num">{unitCost(p.quincePaid.ocean)}</td>
            <td className="num">{unitCost(p.quincePaid.air)}</td>
            <td className="num">{unitCost(p.quincePaid.blend)}</td>
          </tr>
          <tr className={p.basis === "DDP_BLEND" ? "is-used" : undefined}>
            <th>DDP <span className="bs-vendor-meta">highest destination</span></th>
            <td className="num">{p.ddp ? unitCost(p.ddp.ocean) : "—"}</td>
            <td className="num">{p.ddp ? unitCost(p.ddp.air) : "—"}</td>
            <td className="num">{p.ddp ? unitCost(p.ddp.blend) : "—"}</td>
          </tr>
        </tbody>
      </table>
      <p className="bd-note">
        FOB {unitCost(p.fob)} · split Air {g.split.airPct} / Ocean {100 - g.split.airPct}
        {g.split.set ? "" : " (wave default)"} — set on the variant row, shared by every vendor ·
        current landed {unitCost(g.currentLanded)} ·{" "}
        <strong className={p.annualSavings < 0 ? "aw-neg" : undefined}>
          {money(p.annualSavings)} / yr
        </strong>{" "}
        if this vendor took the whole variant
      </p>
      {p.overridden ? (
        <p className="bd-note">
          <Badge>Quince override</Badge> Automatic would pick {label(p.automaticBasis)}.
        </p>
      ) : null}
    </div>
  );
}

/** Cost buckets against the clean sheet, for THIS variant (P7). */
function BucketsSection({ row }: { row: FlatRow }) {
  const g = row.group;
  const { data, loading } = useApi<ProductBids>(
    `/api/styles/${g.styleId}/bids${g.variationId ? `?variationId=${g.variationId}` : ""}`,
  );
  const bid = data?.bids.find((b) => b.vendorId === row.vendor.id);
  const cs = data?.cleanSheet?.buckets ?? null;

  return (
    <div className="section">
      <div className="hd">Cost buckets vs clean sheet</div>
      {loading && !data ? (
        <div className="sk" style={{ blockSize: 140 }} />
      ) : !bid ? (
        <p className="bd-note">No bucket breakdown on this bid.</p>
      ) : (
        <table className="bd-chain">
          <thead>
            <tr><th>Bucket</th><th className="num">This bid</th><th className="num">Clean sheet</th><th className="num">Gap</th></tr>
          </thead>
          <tbody>
            {BUCKET_ORDER.map((k) => {
              const v = bid.bucketTotals[k] ?? 0;
              const c = cs?.[k] ?? null;
              const gap = c ? (v - c) / c : null;
              return (
                <tr key={k}>
                  <th>{BUCKET_LABEL[k]}</th>
                  <td className="num">{unitCost(v)}</td>
                  <td className="num">{c === null ? "—" : unitCost(c)}</td>
                  <td className="num">
                    {gap === null ? "—" : (
                      <span className={gap > 0.1 ? "aw-neg" : undefined}>
                        {gap > 0 ? "+" : ""}{(gap * 100).toFixed(0)}%
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            <tr className="is-used">
              <th>FOB</th>
              <td className="num">{unitCost(bid.fob)}</td>
              <td className="num">{data?.cleanSheet ? unitCost(data.cleanSheet.fob) : "—"}</td>
              <td />
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}
