"use client";

import * as React from "react";
import { Icon } from "@/ds/components";
import { SideDrawer } from "@/components/SideDrawer";
import { decisionText, stageOf, type BidStatus } from "@/domain/bidStatus";

/**
 * The conversation for one vendor x product — decision J3, 4 Oct.
 *
 * Akshay: "a comment is just a feature where, on clicking it, it opens a
 * right drawer, and we see a comment thread against that product from
 * Quince versus from the vendor, so that they can chat." And: "the comments
 * thread is only when Quince is negotiating with the vendor or in any
 * discussions or chats."
 *
 * So this is a CHAT and nothing else. The status, the move control and the
 * withdraw action all stay on the page — a vendor should not have to open a
 * conversation to find out they can decline.
 *
 * TWO PRESENTATIONS, one component. `as="drawer"` on a page; `as="panel"`
 * when it would otherwise open INSIDE another drawer — SideDrawer cannot
 * nest (T11: hardcoded id, duplicate Escape handlers), and the Quince side
 * reaches this from within the bid drawer.
 */

export type ThreadMessage = {
  id: string;
  authorSide: string;
  authorName: string | null;
  body: string;
  statusChange: string | null;
  /** ux/15: MESSAGE | FEEDBACK | UPDATE. Absent on old payloads = MESSAGE. */
  kind?: string | null;
  /** The status the bid was in when this was written. */
  statusFrom?: string | null;
  /** Who wrote it — the signed-in Quince user, or the vendor's email. */
  authorEmail?: string | null;
  createdAt: string;
};

type Filter = "ALL" | "FEEDBACK" | "MESSAGE" | "UPDATE";

/** Older rows have no kind: a Quince status change was feedback, a vendor one an update. */
export function kindOf(m: ThreadMessage): "MESSAGE" | "FEEDBACK" | "UPDATE" {
  if (m.kind === "FEEDBACK" || m.kind === "UPDATE" || m.kind === "MESSAGE") return m.kind;
  if (m.statusChange) return m.authorSide === "QUINCE" ? "FEEDBACK" : "UPDATE";
  return "MESSAGE";
}

/** The stage Quince was reviewing when it wrote this feedback. */
function reviewedStage(m: ThreadMessage): string {
  if (m.statusFrom) return stageOf(m.statusFrom as BidStatus);
  const to = m.statusChange as BidStatus | null;
  if (to === "CHANGES_REQUESTED" || to === "INITIAL_CLEARED") return "Initial quote";
  if (to === "IN_NEGOTIATION" || to === "FINAL_REQUESTED") return "Full costing";
  if (to === "BID_ACCEPTED") return "Final bid";
  return to ? stageOf(to) : "";
}

export function BidThread({
  messages,
  side,
  as = "drawer",
  open = true,
  onClose,
  onSend,
  busy,
  defaultFilter = "ALL",
}: {
  /** Open on one kind — "View feedback" opens on Feedback. */
  defaultFilter?: Filter;
  messages: ThreadMessage[];
  /** Whose screen this is — decides which messages read as "you". */
  side: "QUINCE" | "VENDOR";
  as?: "drawer" | "panel" | "inline";
  open?: boolean;
  onClose?: () => void;
  onSend: (body: string) => Promise<void>;
  busy?: boolean;
}) {
  const [draft, setDraft] = React.useState("");
  const [filter, setFilter] = React.useState<Filter>(defaultFilter);
  const counts = {
    FEEDBACK: messages.filter((m) => kindOf(m) === "FEEDBACK").length,
    MESSAGE: messages.filter((m) => kindOf(m) === "MESSAGE").length,
    UPDATE: messages.filter((m) => kindOf(m) === "UPDATE").length,
  };
  const shown = filter === "ALL" ? messages : messages.filter((m) => kindOf(m) === filter);
  // Date AND time, so the order of a back-and-forth on one day is clear.
  const stamp = (iso: string) =>
    new Date(iso).toLocaleString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  const decision = (m: ThreadMessage) =>
    m.statusChange ? decisionText((m.statusFrom ?? null) as BidStatus | null, m.statusChange as BidStatus) : null;
  const endRef = React.useRef<HTMLDivElement | null>(null);

  // A chat opens at the LATEST message, not the oldest — the newest is what
  // the reader came for.
  React.useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ block: "end" });
  }, [open, messages.length]);

  async function send() {
    const body = draft.trim();
    if (!body) return;
    await onSend(body);
    setDraft("");
  }

  const body = (
    <>
      {/* ONE thread, three kinds (ux/15). Feedback is what Quince wrote
          when it took its turn on a stage; Messages are chat; Updates are
          the system's record of submits and withdrawals. */}
      {messages.length ? (
        <div className="bt-chips" role="group" aria-label="Show">
          {(["ALL", "FEEDBACK", "MESSAGE", "UPDATE"] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              className={`chip${filter === f ? " on" : ""}`}
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
            >
              {f === "ALL" ? "All" : f === "FEEDBACK" ? "Feedback" : f === "MESSAGE" ? "Messages" : "Updates"}
              {f !== "ALL" ? <span className="chip-n">{counts[f]}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
      {shown.length ? (
        <ol className="bt-list">
          {shown.map((m) => {
            const mine = m.authorSide === side;
            const kind = kindOf(m);
            const date = stamp(m.createdAt);
            const party = m.authorSide === "VENDOR" ? "Vendor" : "Quince";
            const who = m.authorEmail ?? m.authorName ?? party;

            if (kind === "UPDATE") {
              return (
                <li key={m.id} className="bt-update">
                  <Icon name="arrow_right" size="sm" />
                  <span>
                    <strong>{decision(m) ?? m.body}</strong>
                    {/* A withdrawal's reason is the vendor's own words. */}
                    {m.statusChange === "WITHDRAWN" && m.body ? `: ${m.body}` : ""}
                    {/variation/i.test(m.body) && m.statusChange !== "WITHDRAWN" ? ` (${m.body.replace(/^Submitted (a quote for )?/i, "").replace(/\.$/, "")})` : ""}
                    {" · "}
                    {party === "Vendor" ? who : `${who}${mine ? " (you)" : ""}`}
                  </span>
                  <time dateTime={m.createdAt}>{date}</time>
                </li>
              );
            }

            return (
              <li key={m.id} className={`bt-msg${mine ? " mine" : ""}${kind === "FEEDBACK" ? " is-feedback" : ""}`}>
                <div className="bt-msg-h">
                  <strong>
                    {who}
                    {mine ? " (you)" : ""}
                  </strong>
                  {kind === "FEEDBACK" ? (
                    <span className="bt-tag bt-tag--feedback">
                      Feedback{reviewedStage(m) ? ` · ${reviewedStage(m)} review` : ""}
                    </span>
                  ) : null}
                  <time dateTime={m.createdAt}>{date}</time>
                </div>
                <p className="bt-msg-b">{m.body}</p>
                {kind === "FEEDBACK" && m.statusChange ? (
                  <p className="bt-msg-f">Decision: {decision(m)}</p>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : messages.length ? (
        <p className="bt-none">Nothing of this kind yet.</p>
      ) : (
        <div className="empty compact">
          <span className="glyph">
            <Icon name="chat" size="lg" />
          </span>
          <div className="ttl">No messages yet</div>
          <div className="desc">
            {side === "QUINCE"
              ? "Ask this vendor a question, or explain what you need changed."
              : "Ask Quince a question about this product."}
          </div>
        </div>
      )}
      <div ref={endRef} />

      <div className="bt-compose">
        <div className="control textarea">
          <textarea
            rows={2}
            value={draft}
            placeholder={
              side === "QUINCE"
                ? "Write to this vendor…"
                : "Write to Quince…"
            }
            onChange={(e) => setDraft(e.target.value)}
          />
        </div>
        <button
          className="btn btn--secondary sm"
          disabled={busy || !draft.trim()}
          onClick={send}
        >
          Send
        </button>
      </div>
    </>
  );

  // A panel respects `open` too, so Comments is a real toggle on both
  // sides rather than the thread always being on screen in one of them.
  // Inside a tab (UX v2: the drawer's Comments tab). Messages scroll; the
  // composer stays pinned at the bottom (Aravind, C53).
  if (as === "inline") {
    return <div className="bt bt-inline">{body}</div>;
  }

  if (as === "panel") {
    if (!open) return null;
    return (
      <div className="bt bt-panel">
        <div className="bt-panel-h">
          <strong>Conversation</strong>
          <button
            type="button"
            className="btn btn--ghost sm"
            onClick={onClose}
          >
            Hide
          </button>
        </div>
        {body}
      </div>
    );
  }

  return (
    <SideDrawer
      open={open}
      onClose={onClose ?? (() => {})}
      title="Conversation"
      sub={side === "QUINCE" ? "You and this vendor" : "You and Quince"}
      size="sm"
    >
      <div className="bt">{body}</div>
    </SideDrawer>
  );
}

/**
 * The vendor's FEEDBACK BAR (Aravind, 8 Oct; ux/15): Quince's latest feedback
 * since the vendor last submitted, below the title and above the tabs.
 * Dismissible, because once read it is digested; the thread keeps it.
 */
export function FeedbackBar({
  comments,
  storageKey,
  onView,
}: {
  comments: ThreadMessage[];
  storageKey: string;
  onView: () => void;
}) {
  // Read once at mount. The bar only renders after the thread has loaded,
  // which is always client-side, so there is no server/client mismatch.
  const [dismissed, setDismissed] = React.useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      return window.localStorage.getItem(storageKey);
    } catch {
      return null; // storage blocked: the bar simply shows
    }
  });

  const latest = [...comments].reverse().find((c) => kindOf(c) === "FEEDBACK" && c.authorSide === "QUINCE");
  const lastSubmit = [...comments].reverse().find((c) => c.authorSide === "VENDOR" && c.statusChange);
  if (!latest || dismissed === latest.id) return null;
  if (lastSubmit && new Date(lastSubmit.createdAt) > new Date(latest.createdAt)) return null;

  const stage = reviewedStage(latest);
  const text = latest.body.length > 160 ? `${latest.body.slice(0, 157)}…` : latest.body;
  return (
    <div className="bar bar--warning fb-bar" role="status">
      <Icon name="chat" />
      <div className="fb-bar-b">
        <strong>Quince left feedback{stage ? ` on your ${stage.toLowerCase()}` : ""}.</strong> &ldquo;{text}&rdquo;
      </div>
      <div className="fb-bar-acts">
        <button type="button" className="btn btn--secondary sm" onClick={onView}>
          View feedback
        </button>
        <button
          type="button"
          className="btn btn--ghost sm icon"
          aria-label="Dismiss"
          onClick={() => {
            setDismissed(latest.id);
            try {
              window.localStorage.setItem(storageKey, latest.id);
            } catch {
              /* ignore */
            }
          }}
        >
          <Icon name="close" size="sm" />
        </button>
      </div>
    </div>
  );
}
