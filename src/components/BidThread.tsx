"use client";

import * as React from "react";
import { Icon } from "@/ds/components";
import { SideDrawer } from "@/components/SideDrawer";

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
  createdAt: string;
};

export function BidThread({
  messages,
  side,
  as = "drawer",
  open = true,
  onClose,
  onSend,
  busy,
}: {
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
      {messages.length ? (
        <ol className="bt-list">
          {messages.map((m) => {
            const mine = m.authorSide === side;
            return (
              <li key={m.id} className={`bt-msg${mine ? " mine" : ""}`}>
                <div className="bt-msg-h">
                  <strong>
                    {mine
                      ? "You"
                      : (m.authorName ??
                        (m.authorSide === "VENDOR" ? "Vendor" : "Quince"))}
                  </strong>
                  {/* A status change shows in the SAME thread, so the
                      decisions and the chat read as one history (H6). */}
                  {m.statusChange ? (
                    <span className="bt-tag">
                      <Icon name="arrow_right" size="sm" />
                      changed the status
                    </span>
                  ) : null}
                  <time dateTime={m.createdAt}>
                    {new Date(m.createdAt).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                    })}
                  </time>
                </div>
                <p className="bt-msg-b">{m.body}</p>
              </li>
            );
          })}
        </ol>
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
