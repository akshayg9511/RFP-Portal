"use client";

import * as React from "react";
import { SideDrawer } from "@/components/SideDrawer";
import { BidMoveMenu } from "@/components/BidMoveMenu";
import { BidStatusInfo } from "@/components/BidStatusInfo";
import { BidThread, type ThreadMessage } from "@/components/BidThread";
import { Badge, Icon } from "@/ds/components";
import { useApi } from "@/lib/useApi";
import { unitCost, units } from "@/lib/format";
import type { BidStatus } from "@/domain/bidStatus";

/**
 * One vendor's bid on one product, over the RFP.
 *
 * UX v2 layout (Aravind C16–C18, walkthrough 8 Oct, decision D2):
 *   status badge + ⓘ lifecycle tooltip, and "Move ▾" at the top right
 *   → a message bar carrying the latest note, dismissible, with View
 *   → two tabs: Bid details · Comments (n). No Activity tab for now (D3).
 *
 * The cost breakdown is unchanged: bucket totals, each expanding to the
 * lines behind it (Build Doc §10.2).
 */

type Line = {
  key: string;
  label: string;
  unit?: string;
  derived?: boolean;
  inputType?: string;
};

type QuoteDetail = {
  style: {
    styleNumber: string;
    name: string;
    material: string | null;
    planUnits: number | null;
    heroImage: string | null;
    sizes: string[];
  };
  template: {
    definition: { sections: { key: string; label: string; lines: Line[] }[] };
  };
  quote: {
    status: string;
    values: Record<string, number | string | null>;
    bucketTotals: Record<string, number> | null;
    fob: number | null;
  } | null;
};

type BidView = {
  status: BidStatus;
  quinceLabel: string;
  vendorLabel: string;
  statusNote: string | null;
  comments: ThreadMessage[];
};

const BUCKET_LABEL: Record<string, string> = {
  BASE_MATERIALS: "Materials",
  TRIM_HARDWARE: "Trim + hardware",
  PACKAGING: "Packaging",
  CRAFTING: "Crafting",
  OVERHEAD_SGA_PROFIT: "Overhead + SG&A",
};

export type DrawerTab = "details" | "comments";

export function QuoteDrawer({
  invitationId,
  styleId,
  vendorName,
  initialTab = "details",
  onClose,
  onChanged,
}: {
  invitationId: string | null;
  styleId: string | null;
  vendorName: string | null;
  initialTab?: DrawerTab;
  onClose: () => void;
  /** A move or a message changed the bid — the page refreshes its rows. */
  onChanged?: () => void;
}) {
  const key = invitationId && styleId ? `${invitationId}/${styleId}` : null;
  const { data, loading } = useApi<QuoteDetail>(key ? `/api/quotes/${key}` : null);
  const bid = useApi<BidView>(key ? `/api/bids/${key}?side=QUINCE` : null);

  return (
    <SideDrawer
      open={key !== null}
      onClose={onClose}
      title={vendorName ?? "Bid"}
      sub={data ? `${data.style.styleNumber} · ${data.style.name}` : undefined}
    >
      {/* Keyed by bid, so tab, open buckets and a dismissed bar reset when
          the drawer moves to another bid — no effect needed. */}
      {key ? (
        <DrawerContent
          key={`${key}:${initialTab}`}
          invitationId={invitationId!}
          styleId={styleId!}
          vendorName={vendorName}
          initialTab={initialTab}
          data={data}
          loading={loading}
          bid={bid.data}
          reloadBid={() => {
            bid.reload();
            onChanged?.();
          }}
        />
      ) : null}
    </SideDrawer>
  );
}

function DrawerContent({
  invitationId,
  styleId,
  vendorName,
  initialTab,
  data,
  loading,
  bid,
  reloadBid,
}: {
  invitationId: string;
  styleId: string;
  vendorName: string | null;
  initialTab: DrawerTab;
  data: QuoteDetail | null | undefined;
  loading: boolean;
  bid: BidView | null | undefined;
  reloadBid: () => void;
}) {
  const [tab, setTab] = React.useState<DrawerTab>(initialTab);
  const [open, setOpen] = React.useState<Set<string>>(new Set());
  const [barDismissed, setBarDismissed] = React.useState(false);
  const [sending, setSending] = React.useState(false);

  const values = data?.quote?.values ?? {};
  const commentCount = bid?.comments.length ?? 0;

  function toggle(sectionKey: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(sectionKey)) next.delete(sectionKey);
      else next.add(sectionKey);
      return next;
    });
  }

  async function sendMessage(body: string) {
    setSending(true);
    try {
      await fetch(`/api/bids/${invitationId}/${styleId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ authorSide: "QUINCE", note: body }),
      });
      reloadBid();
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      {/* STATUS ROW — the badge says where it is, ⓘ the whole lifecycle,
          and Move sits at the trailing edge. */}
      <div className="qd-status">
        {bid ? (
          <>
            <Badge tone={bid.status === "NOT_PROCEEDING" ? "danger" : undefined}>
              {bid.quinceLabel}
            </Badge>
            <BidStatusInfo status={bid.status} />
            <span className="qd-vendor-sees">
              Vendor sees <strong>{bid.vendorLabel}</strong>
            </span>
            <span className="qd-status-acts">
              <BidMoveMenu
                invitationId={invitationId}
                styleId={styleId}
                status={bid.status}
                label="Move this bid"
                onMoved={reloadBid}
              />
            </span>
          </>
        ) : (
          <div className="sk" style={{ blockSize: 28, inlineSize: "60%" }} />
        )}
      </div>

      {/* MESSAGE BAR — the latest note, once, with a way to the thread. */}
      {bid?.statusNote && !barDismissed ? (
        <div className="bar bar--info qd-bar">
          <Icon name="chat" />
          <div>
            <strong>Latest note:</strong> {bid.statusNote}
            {tab !== "comments" ? (
              <>
                {" "}
                <button type="button" className="qd-link" onClick={() => setTab("comments")}>
                  View
                </button>
              </>
            ) : null}
          </div>
          <button
            type="button"
            className="x"
            aria-label="Dismiss"
            onClick={() => setBarDismissed(true)}
          >
            <Icon name="close" />
          </button>
        </div>
      ) : null}

      <div className="tabs qd-tabs" role="tablist" aria-label="Bid">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "details"}
          className={tab === "details" ? "tab on" : "tab"}
          onClick={() => setTab("details")}
        >
          Bid details
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "comments"}
          className={tab === "comments" ? "tab on" : "tab"}
          onClick={() => setTab("comments")}
        >
          Comments{commentCount ? <span className="ct">{commentCount}</span> : null}
        </button>
      </div>

      {tab === "comments" ? (
        bid ? (
          <BidThread
            messages={bid.comments}
            side="QUINCE"
            as="inline"
            busy={sending}
            onSend={sendMessage}
          />
        ) : (
          <div className="sk" style={{ blockSize: 200 }} />
        )
      ) : (
        <>
          {loading ? <div className="sk" style={{ blockSize: 240 }} /> : null}

          {data && !data.quote ? (
            <div className="empty compact">
              <span className="glyph">
                <Icon name="clock" size="lg" />
              </span>
              <div className="ttl">No bid yet</div>
              <div className="desc">
                {vendorName} has not submitted for this product. You can still
                message them from Comments.
              </div>
            </div>
          ) : null}

          {data?.quote ? (
            <>
              {data.style.heroImage ? (
                <div className="detail-hero">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={data.style.heroImage} alt={data.style.name} />
                </div>
              ) : null}

              <div className="quote-total" style={{ marginBlockStart: "var(--space-lg)" }}>
                <div className="k">Their FOB</div>
                <div className="v">{unitCost(data.quote.fob)}</div>
              </div>

              <div className="section">
                <div className="hd">Product</div>
                <dl className="fact-list">
                  <Row k="Style" v={data.style.styleNumber} />
                  <Row k="Material" v={data.style.material ?? "—"} />
                  {data.style.sizes.length ? (
                    <Row k="Sizes" v={data.style.sizes.join(" · ")} />
                  ) : null}
                  <Row k="Plan units" v={`${units(data.style.planUnits)} / yr`} />
                </dl>
              </div>

              <div className="section">
                <div className="hd">Cost breakdown</div>
                {data.template.definition.sections.map((section) => {
                  const lines = section.lines.filter(
                    (l) =>
                      !l.derived &&
                      values[l.key] !== undefined &&
                      values[l.key] !== "" &&
                      values[l.key] !== null,
                  );
                  if (!lines.length) return null;

                  const isOpen = open.has(section.key);
                  const total = Number(data.quote?.bucketTotals?.[section.key] ?? 0);
                  return (
                    <div className="bid-bucket" key={section.key}>
                      <button
                        className="bid-bucket-head"
                        onClick={() => toggle(section.key)}
                        aria-expanded={isOpen}
                      >
                        <Icon name={isOpen ? "chevron_up" : "chevron_down"} size="sm" />
                        <span className="bid-bucket-name">
                          {BUCKET_LABEL[section.key] ?? section.label}
                        </span>
                        <span className="bid-bucket-total">{unitCost(total)}</span>
                      </button>

                      {isOpen ? (
                        <dl className="fact-list bid-bucket-lines">
                          {lines.map((line) => (
                            <Row
                              key={line.key}
                              k={line.label}
                              v={
                                line.unit === "USD"
                                  ? unitCost(Number(values[line.key]))
                                  : String(values[line.key])
                              }
                            />
                          ))}
                        </dl>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </>
          ) : null}
        </>
      )}
    </>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </>
  );
}
