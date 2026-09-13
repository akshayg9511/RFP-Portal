'use client';

import * as React from 'react';
import { cx } from './cx';
import { Icon } from './Icon';
import type { IconName } from './iconNames';

/* ── DRAG DEPTH ────────────────────────────────────────────
   Extracted from the component so it can be tested without a DOM.

   `dragenter` and `dragleave` fire for EVERY descendant, not just the zone. So
   moving the pointer from the zone onto the glyph inside it fires leave-then-enter,
   and a plain boolean drops to false for a frame — the zone flickers under a
   stationary drag. Counting depth instead means the state only clears when the
   last nested target is left.

   `drop` resets to 0 outright rather than decrementing: the browser does not fire
   a matching `dragleave` for the target that received the drop, so decrementing
   would leave the count stuck above zero and the zone lit forever. */
export type DragPhase = 'enter' | 'leave' | 'drop';

export function dragDepth(depth: number, phase: DragPhase): number {
  switch (phase) {
    case 'enter':
      return depth + 1;
    case 'leave':
      /* Clamped at 0. A drag that begins INSIDE the zone (the pointer was already
         over it when the drag started) can deliver a leave with no matching enter,
         which would otherwise drive the count negative and make the next enter
         fail to light the zone. */
      return Math.max(0, depth - 1);
    case 'drop':
      return 0;
  }
}

/** The zone is lit whenever any nested target is still entered. */
export const isDragOver = (depth: number): boolean => depth > 0;

export interface DropZoneProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title' | 'onDrop'> {
  title: React.ReactNode;
  /** Accepted types and the size cap. State the rule HERE, before it is
   *  broken — it prevents the error the rejection message would explain. */
  hint?: React.ReactNode;
  glyph?: IconName;
  /** Rejected type or size. Say WHICH rule was broken and what the file was;
   *  "invalid file" leaves the user guessing between format and size. */
  invalid?: boolean;
  onFiles?: (files: File[]) => void;
  /** Label for the inline browse control — usually the word "browse", with the
   *  sentence up to it in `title`. WITHOUT this the zone has no keyboard path to
   *  the picker at all: drag and drop is a pointer gesture, so a keyboard or
   *  switch user cannot upload. `.drop:focus-within` exists in ds/ precisely for
   *  this control, and could never fire while nothing focusable lived in here. */
  browse?: React.ReactNode;
  accept?: string;
  multiple?: boolean;
}

/**
 * `.drop` — the zone. Drag state is tracked with a counter rather than a
 * boolean: dragenter/dragleave fire for every descendant, so a plain boolean
 * flickers off the moment the pointer crosses the glyph inside the zone. The
 * counter is the whole reason this component holds state at all.
 *
 * `invalid` and the live drag state can both be true — a user retrying after a
 * rejection is dragging over a zone that still carries the error. Both classes
 * are emitted and the CSS decides; `.drop.invalid` comes later in the sheet, so
 * the rejection keeps precedence, which is the right call: the reason the last
 * attempt failed matters more than the fact that another is in progress.
 */
export const DropZone = React.forwardRef<HTMLDivElement, DropZoneProps>(function DropZone(
  { title, hint, glyph = 'share', invalid, onFiles, browse, accept, multiple, className, children, ...rest },
  ref,
) {
  const [over, setOver] = React.useState(0);
  const picker = React.useRef<HTMLInputElement>(null);

  return (
    <div
      ref={ref}
      className={cx('drop', isDragOver(over) && 'on', invalid && 'invalid', className)}
      onDragEnter={(e) => { e.preventDefault(); setOver((n) => dragDepth(n, 'enter')); }}
      onDragLeave={() => setOver((n) => dragDepth(n, 'leave'))}
      // Without preventDefault on dragOver the browser refuses the drop and
      // navigates to the file instead — the classic silent failure here.
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        setOver((n) => dragDepth(n, 'drop'));
        if (e.dataTransfer?.files?.length) onFiles?.([...e.dataTransfer.files]);
      }}
      {...rest}
    >
      <span className="plate">
        <Icon name={glyph} size="lg" />
      </span>
      <div className="ttl">
        {title}
        {browse != null && (
          <>
            {' '}
            {/* A real <button class="lnk">, not an <em>. The CSS says so, and it
                is the difference between a zone a keyboard user can use and one
                they cannot. */}
            <button type="button" className="lnk" onClick={() => picker.current?.click()}>
              {browse}
            </button>
          </>
        )}
      </div>
      {hint != null && <div className="hint">{hint}</div>}
      {browse != null && (
        <input
          ref={picker}
          type="file"
          accept={accept}
          multiple={multiple}
          style={{ display: 'none' }}
          onChange={(e) => {
            const picked = e.target.files;
            if (picked?.length) onFiles?.([...picked]);
            /* Cleared so choosing the SAME file twice fires change again — the
               input keeps its value otherwise and the second attempt is silent. */
            e.target.value = '';
          }}
        />
      )}
      {children}
    </div>
  );
});

/** `.file-list` — a stack of rows. */
export function FileList({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('file-list', className)} {...rest}>
      {children}
    </div>
  );
}

/* `error` and `progress` are the one genuine contradiction in this row: a failed
   upload has no bar to show, and a row in flight has not failed yet. Everything
   else here is content, so it stays a slot rather than becoming a state — the CSS
   defines exactly ONE state class on this element (`.file-row.error`), and
   Figma's `File: Complete|Uploading|Failed` is a specimen list, not a third class. */
interface FileRowBase extends React.HTMLAttributes<HTMLDivElement> {
  name: React.ReactNode;
  /** Size, status, or the failure reason. Sits in `.meta` under the name. */
  meta?: React.ReactNode;
  glyph?: IconName;
  /** Trailing slot, beside the name rather than under it: the percentage, a
   *  status glyph, a Retry action. */
  trail?: React.ReactNode;
  onRemove?: () => void;
  removeLabel?: string;
}

/** Settled — uploaded, or failed. */
export interface FileRowSettledProps extends FileRowBase {
  /** Per-file failure. The row STAYS in the list carrying its reason and a
   *  retry — removing a failed upload silently is how a user ends up believing
   *  eight of ten files arrived. */
  error?: boolean;
  progress?: never;
}

/** In flight. */
export interface FileRowUploadingProps extends FileRowBase {
  /** The bar goes INSIDE `.meta`, under the filename — not in the trailing slot,
   *  which would squeeze the name it belongs to out of the row. Pass a
   *  `<Progress thin>`; ds/ gives it the line box the status line would have had,
   *  so the row is one height for its whole life. */
  progress: React.ReactNode;
  error?: never;
}

export type FileRowProps = FileRowSettledProps | FileRowUploadingProps;

/** `.file-row` — one file. Progress belongs per row, not per batch: a user who
 *  dropped six files needs to know which one is stuck. */
export function FileRow(props: FileRowProps) {
  const { name, meta, glyph = 'articles', trail, onRemove, removeLabel, className, ...rest } = props;
  const error = 'error' in props && props.error === true;
  const progress = 'progress' in props ? props.progress : undefined;
  const { error: _e, progress: _p, ...attrs } = rest as Record<string, unknown>;
  return (
    <div className={cx('file-row', error && 'error', className)}
         {...(attrs as React.HTMLAttributes<HTMLDivElement>)}>
      <Icon name={glyph} />
      <div className="meta">
        <span className="fn">{name}</span>
        {progress}
        {meta != null && <span className="fs">{meta}</span>}
      </div>
      {trail}
      {onRemove && (
        <button type="button" className="x" aria-label={removeLabel ?? 'Remove file'} onClick={onRemove}>
          <Icon name="close" />
        </button>
      )}
    </div>
  );
}