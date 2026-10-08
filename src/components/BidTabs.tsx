"use client";

import * as React from "react";
import { useApi } from "@/lib/useApi";
import { BidMoveMenu } from "@/components/BidMoveMenu";
import { BidStatusPanel, type PanelNote } from "@/components/BidStatusPanel";
import { BidThread, type ThreadMessage } from "@/components/BidThread";
import { turnOf, type BidStatus } from "@/domain/bidStatus";

/**
 * The body of every Quince bid drawer — the RFP page's and Bid summary's —
 * so the two cannot drift (UX v2: Aravind C16–C18 / C31–C33, walkthrough
 * 8 Oct, decisions D2 + D3):
 *
 *   BidStatusPanel — status + "Move this bid ▾", step N of M (opens the
 *   lifecycle in place), what the vendor sees, the latest note as a quote
 *   → two tabs: Bid details (the caller's content) · Comments (n)
 *
 * No Activity tab for now (D3).
 */

type BidView = {
  status: BidStatus;
  quinceLabel: string;
  vendorLabel: string;
  statusNote: string | null;
  statusChangedAt: string | null;
  comments: ThreadMessage[];
};

/** The note that came with the last status change, with who and when. */
function latestNote(d: BidView): PanelNote | null {
  if (!d.statusNote) return null;
  const msg = [...d.comments].reverse().find((c) => c.statusChange && c.body === d.statusNote)
    ?? [...d.comments].reverse().find((c) => c.statusChange);
  const author = !msg
    ? "Quince"
    : msg.authorSide === "QUINCE"
      ? (msg.authorName ?? "Quince")
      : (msg.authorName ?? "Vendor");
  return { body: d.statusNote, author, at: msg?.createdAt ?? d.statusChangedAt };
}

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
      {data ? (
        <BidStatusPanel
          status={data.status}
          label={data.quinceLabel}
          otherSide={{ who: "Vendor", label: data.vendorLabel }}
          changedAt={data.statusChangedAt}
          note={latestNote(data)}
          tone={turnOf(data.status) === "QUINCE" ? "attention" : "neutral"}
          action={
            <BidMoveMenu
              invitationId={invitationId}
              styleId={styleId}
              status={data.status}
              label="Move this bid"
              onMoved={changed}
            />
          }
          onViewConversation={tab !== "comments" ? () => setTab("comments") : undefined}
        />
      ) : (
        <div className="sk" style={{ blockSize: 96, marginBlockEnd: "var(--space-md)" }} />
      )}

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
