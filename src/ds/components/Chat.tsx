'use client';

import * as React from 'react';
import { cx } from './cx';

export interface ChatProps extends React.HTMLAttributes<HTMLDivElement> {}

export function Chat({ className, children, ...rest }: ChatProps) {
  return (
    <div className={cx('chat', className)} {...rest}>
      {children}
    </div>
  );
}

export interface ChatLogProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Pin to the newest message. Re-runs whenever this value changes — pass the
   *  message count or the last id. */
  stickTo?: unknown;
}

/**
 * `.chat-log` — the only region that scrolls.
 *
 * Auto-scroll is the one behaviour here, and it is deliberately dumb: it pins
 * on every change to `stickTo`. It does NOT try to detect whether the user has
 * scrolled up to read history, because getting that wrong yanks someone away
 * from what they were reading — if your log is long enough for that to matter,
 * own the scrolling yourself and leave `stickTo` unset.
 */
export const ChatLog = React.forwardRef<HTMLDivElement, ChatLogProps>(function ChatLog(
  { stickTo, className, children, ...rest },
  ref,
) {
  const inner = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (stickTo === undefined) return;
    const el = inner.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [stickTo]);

  return (
    <div
      ref={(node) => {
        inner.current = node;
        if (typeof ref === 'function') ref(node);
        else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
      }}
      className={cx('chat-log', className)}
      {...rest}
    >
      {children}
    </div>
  );
});

export type ChatMessageState = 'pending' | 'failed';

export interface ChatMessageProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Outgoing — mirrored, emphasis surface, tight trailing corner. */
  me?: boolean;
  /** pending — in flight, bubble dims. failed — dims plus a danger meta line.
   *  The message is NEVER removed in either: the text the user wrote is the
   *  thing at risk, and it stays on screen where they can copy it. */
  state?: ChatMessageState;
  /** Author, shown once per turn. */
  who?: React.ReactNode;
  /** Time plus delivery state. Alignment separates speakers visually; this
   *  names them, because a colour-and-position distinction fails for anyone
   *  who cannot see it. */
  meta?: React.ReactNode;
  /** Avatar or similar, before the bubble. */
  avatar?: React.ReactNode;
}

export function ChatMessage({
  me,
  state,
  who,
  meta,
  avatar,
  className,
  children,
  ...rest
}: ChatMessageProps) {
  return (
    <div className={cx('chat-msg', me && 'me', state, className)} {...rest}>
      {avatar}
      {who != null && <span className="who">{who}</span>}
      <div className="chat-bubble">{children}</div>
      {meta != null && <div className="chat-meta">{meta}</div>}
    </div>
  );
}

/** `.chat-typing` — three dots. An AMBIENT animation, so under
 *  prefers-reduced-motion it stops rather than collapsing to 0ms; a looping
 *  indicator honouring the preference by running at frame rate is the failure
 *  that rule exists to prevent. */
export function ChatTyping({ className, ...rest }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={cx('chat-typing', className)} role="status" aria-label="Typing" {...rest}>
      <i />
      <i />
      <i />
    </span>
  );
}

/** `.chat-composer` — pinned below the log, with a top rule. */
export function ChatComposer({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('chat-composer', className)} {...rest}>
      {children}
    </div>
  );
}