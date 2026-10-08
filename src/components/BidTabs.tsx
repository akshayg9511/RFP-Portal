"use client";

import * as React from "react";
import { Badge, Icon } from "@/ds/components";
import { useApi } from "@/lib/useApi";
import { BidMoveMenu } from "@/components/BidMoveMenu";
import { BidStatusInfo } from "@/components/BidStatusInfo";
import { BidThread, type ThreadMessage } from "@/components/BidThread";
import type { BidStatus } from "@/domain/bidStatus";

/**
 * The body of every Quince bid drawer — the RFP page's and Bid summary's —
 * so the two cannot drift (UX v2: Aravind C16–C18 / C31–C33, walkthrough
 * 8 Oct, decisions D2 + D3):
 *
 *   status badge · ⓘ lifecycle tooltip · "Move this bid ▾" at the trailing edge
 *   → the latest note as a dismissible message bar, with View
 *   → two tabs: Bid details (the caller's content) · Comments (n)
 *
 * No Activity tab for now (D3).
 */

type BidView = {
  status: BidStatus;
  quinceLabel: string;
  vendorLabel: string;
  statusNote: string | null;
  comments: ThreadMessage[];
};

export type BidTab = "details" | "comments";

export function BidTabs({
  invitationId,
  styleId,
  initialTab = "details",
  onChanged,
  children,
}: {
  invitationId: string;
  styleId: string;
  initialTab?: BidTab;
  /** A move or a message changed the bid. */
  onChanged?: () => void;
  /** The Bid details tab. */
  children: React.ReactNode;
}) {
  const bid = useApi<BidView>(`/api/bids/${invitationId}/${styleId}?side=QUINCE`);
  const [tab, setTab] = React.useState<BidTab>(initialTab);
  const [barDismissed, setBarDismissed] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const data = bid.data;

  function changed() {
    bid.reload();
    onChanged?.();
  }

  async function send(body: string) {
    setSending(true);
    try {
      await fetch(`/api/bids/${invitationId}/${styleId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ authorSide: "QUINCE", note: body }),
      });
      changed();
    } finally {
      setSending(false);
    }
  }

  const count = data?.comments.length ?? 0;

  return (
    <>
      <div className="qd-status">
        {data ? (
          <>
            <Badge tone={data.status === "NOT_PROCEEDING" ? "danger" : undefined}>
              {data.quinceLabel}
            </Badge>
            <BidStatusInfo status={data.status} />
            <span className="qd-vendor-sees">
              Vendor sees <strong>{data.vendorLabel}</strong>
            </span>
            <span className="qd-status-acts">
              <BidMoveMenu
                invitationId={invitationId}
                styleId={styleId}
                status={data.status}
                label="Move this bid"
                onMoved={changed}
              />
            </span>
          </>
        ) : (
          <div className="sk" style={{ blockSize: 28, inlineSize: "60%" }} />
        )}
      </div>

      {data?.statusNote && !barDismissed ? (
        <div className="bar bar--info qd-bar">
          <Icon name="chat" />
          <div>
            <strong>Latest note:</strong> {data.statusNote}
            {tab !== "comments" ? (
              <>
                {" "}
                <button type="button" className="qd-link" onClick={() => setTab("comments")}>
                  View
                </button>
              </>
            ) : null}
          </div>
          <button type="button" className="x" aria-label="Dismiss" onClick={() => setBarDismissed(true)}>
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
          Comments{count ? <span className="ct">{count}</span> : null}
        </button>
      </div>

      {tab === "comments" ? (
        data ? (
          <BidThread messages={data.comments} side="QUINCE" as="inline" busy={sending} onSend={send} />
        ) : (
          <div className="sk" style={{ blockSize: 200 }} />
        )
      ) : (
        children
      )}
    </>
  );
}
