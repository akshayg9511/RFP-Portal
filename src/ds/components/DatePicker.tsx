'use client';

import * as React from 'react';
import { cx } from './cx';
import { Icon } from './Icon';

/* Presentational, on the same terms as Select: this renders the DS calendar and
   time-list markup and computes the month GRID — layout arithmetic the CSS cannot
   do — but it owns no date state, no popover positioning and no keyboard model.
   Pair it with your own overlay primitive.

   THE FIELD IS THE CONTROL. A date is typed as often as it is picked, so a date
   input is a <Field>/<Control> that always accepts typing; this is the shortcut
   anchored beside it, never the only way in. Date and time are two fields, never
   one — people know the date long before the hour. */

export type WeekStart = 0 | 1;

export interface CalendarCell {
  date: Date;
  /** Outside the month shown. Rendered `.muted`, still a real date. */
  outside: boolean;
}

/** Sunday-first, rotated by `weekStartsOn`. Single letters, matching the system's
 *  specimen; pass `dayLabels` for a different locale. */
const LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;

/**
 * SIX ROWS ALWAYS — 42 cells.
 *
 * A month needs five rows or six depending on the weekday it starts on, and
 * sizing the grid to the month means the surface changes height as the user pages
 * through it: an anchored popover jumps, and the footer moves out from under the
 * pointer that was about to click Apply. A fixed six rows costs one row of muted
 * days in the short months and buys a calendar that never moves.
 *
 * The storybook shipped 38 cells — five full rows plus a ragged sixth of three —
 * until ds/ v146's sibling change; the caption had said "42 cells" the whole time.
 *
 * Pure and exported so it can be tested without a renderer.
 */
export function calendarGrid(month: Date, weekStartsOn: WeekStart = 1): CalendarCell[] {
  const y = month.getFullYear();
  const m = month.getMonth();
  /* Leading days from the previous month. Date() normalises a non-positive day
     back across the month boundary, so no second construction is needed. */
  const lead = (new Date(y, m, 1).getDay() - weekStartsOn + 7) % 7;
  return Array.from({ length: 42 }, (_, i) => {
    const date = new Date(y, m, 1 - lead + i);
    return { date, outside: date.getMonth() !== m };
  });
}

/** Same calendar day, ignoring the clock. */
export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export interface CalendarDayProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  /** Adjacent month. Dimmed, still pressable. */
  muted?: boolean;
  /** Today is a LANDMARK, not a selection — an inset ring, never the selected
   *  fill. A calendar shows both facts at once. */
  today?: boolean;
  selected?: boolean;
  /** Range ends. The radius goes tight on the INNER side only, so a run reads as
   *  one bar with rounded ends rather than a row of separate chips. */
  rangeStart?: boolean;
  rangeEnd?: boolean;
  /** Between the ends: the selected tint, square. */
  inRange?: boolean;
  /** Struck through, never hidden — a missing row reads as a rendering bug, a
   *  struck one reads as a closed date. Disabling a date without saying why is
   *  wrong; the reason belongs beside the calendar. */
  unavailable?: boolean;
}

/** `.cal-day` — one day cell. A real <button>; the CSS supplies the UA reset it
 *  needs, because a `<button>` defaults to the system font at ~13.3px. */
export const CalendarDay = React.forwardRef<HTMLButtonElement, CalendarDayProps>(
  function CalendarDay(
    { muted, today, selected, rangeStart, rangeEnd, inRange, unavailable, className, ...rest },
    ref,
  ) {
    const on = Boolean(selected || rangeStart || rangeEnd);
    return (
      <button
        ref={ref}
        type="button"
        disabled={unavailable || rest.disabled}
        /* Always emitted, never only when true. `aria-pressed={selected}` with
           selected undefined makes React drop the attribute, so chosen days
           announce their state and the rest are silent — worse than having no
           state at all. That exact bug shipped on Chip and was fixed the same way. */
        aria-pressed={unavailable ? undefined : on}
        className={cx(
          'cal-day',
          muted && 'muted',
          today && 'today',
          on && 'on',
          rangeStart && 'start',
          rangeEnd && 'end',
          inRange && !on && 'range',
          unavailable && 'off',
          className,
        )}
        {...rest}
      />
    );
  },
);

export interface CalendarFooterProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Shortcuts — Today, Clear. They are not commits, so they read from the
   *  LEADING edge; only the commit sits at the trailing one. */
  lead?: React.ReactNode;
}

/** `.cal-f` — flush inside an already-padded surface, and its hairline is
 *  transparent: a date picker is one glance top to bottom, so padding is the
 *  separation. The rule is kept in the box so the row's rhythm does not shift. */
export function CalendarFooter({ lead, className, children, ...rest }: CalendarFooterProps) {
  return (
    <div className={cx('cal-f', className)} {...rest}>
      {lead}
      <span className="sp" />
      {children}
    </div>
  );
}

export interface CalendarProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onSelect'> {
  /** Any date inside the month to show. */
  month: Date;
  onMonthChange?: (month: Date) => void;
  /** Single-date selection. */
  selected?: Date;
  /** Range selection. Use instead of `selected`, not alongside it. */
  rangeStart?: Date;
  rangeEnd?: Date;
  /** Defaults to the real today. Pass it explicitly to render deterministically. */
  today?: Date;
  isUnavailable?: (date: Date) => boolean;
  onSelect?: (date: Date) => void;
  weekStartsOn?: WeekStart;
  dayLabels?: readonly string[];
  /** Pass a `<CalendarFooter>`. Optional — most pickers commit on the click. */
  footer?: React.ReactNode;
  /** Overrides the formatted "May 2026". */
  monthLabel?: React.ReactNode;
  prevLabel?: string;
  nextLabel?: string;
}

/**
 * `.cal` — the month surface, 296px on a raised surface with the overlay
 * elevation.
 *
 * Below the turn every cell grows to the touch floor and the surface widens to
 * hold them: a day grid GROWS rather than overlaying, because 44px overlays on
 * 32px cells would overlap each other and the tap would land on the wrong day.
 * That is all CSS — nothing here changes.
 */
export const Calendar = React.forwardRef<HTMLDivElement, CalendarProps>(function Calendar(
  {
    month,
    onMonthChange,
    selected,
    rangeStart,
    rangeEnd,
    today,
    isUnavailable,
    onSelect,
    weekStartsOn = 1,
    dayLabels,
    footer,
    monthLabel,
    prevLabel = 'Previous month',
    nextLabel = 'Next month',
    className,
    ...rest
  },
  ref,
) {
  const cells = calendarGrid(month, weekStartsOn);
  const labels = dayLabels ?? LETTERS.map((_, i) => LETTERS[(i + weekStartsOn) % 7] ?? '');
  const label =
    monthLabel ?? month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const step = (by: number) =>
    onMonthChange?.(new Date(month.getFullYear(), month.getMonth() + by, 1));

  return (
    <div ref={ref} className={cx('cal', className)} {...rest}>
      <div className="cal-h">
        <button type="button" className="nav" aria-label={prevLabel} onClick={() => step(-1)}>
          <Icon name="chevron_left" size="sm" />
        </button>
        <span className="mo">{label}</span>
        <button type="button" className="nav" aria-label={nextLabel} onClick={() => step(1)}>
          <Icon name="chevron_right" size="sm" />
        </button>
      </div>

      {/* A flat grid: .cal-grid is 7 columns, so the day-of-week labels and the
          cells are siblings and there are no row wrappers to keep in sync. */}
      <div className="cal-grid">
        {labels.map((d, i) => (
          <div key={`dow-${i}`} className="cal-dow">
            {d}
          </div>
        ))}
        {cells.map(({ date, outside }) => {
          const off = isUnavailable?.(date) ?? false;
          const isStart = rangeStart != null && isSameDay(date, rangeStart);
          const isEnd = rangeEnd != null && isSameDay(date, rangeEnd);
          const between =
            rangeStart != null && rangeEnd != null && date > rangeStart && date < rangeEnd;
          return (
            <CalendarDay
              key={date.toISOString()}
              muted={outside}
              today={today != null ? isSameDay(date, today) : isSameDay(date, new Date())}
              selected={selected != null && isSameDay(date, selected)}
              rangeStart={isStart}
              rangeEnd={isEnd}
              inRange={between}
              unavailable={off}
              onClick={off ? undefined : () => onSelect?.(date)}
            >
              {date.getDate()}
            </CalendarDay>
          );
        })}
      </div>

      {footer}
    </div>
  );
});

export interface TimeListProps extends React.HTMLAttributes<HTMLDivElement> {}

/** `.time-list` — a 160px menu of times, capped so it SCROLLS rather than
 *  growing. The cap is a scroll boundary, not a count. */
export const TimeList = React.forwardRef<HTMLDivElement, TimeListProps>(function TimeList(
  { className, children, ...rest },
  ref,
) {
  return (
    <div ref={ref} role="listbox" className={cx('time-list', className)} {...rest}>
      {children}
    </div>
  );
});

export interface TimeOptionProps extends React.HTMLAttributes<HTMLDivElement> {
  selected?: boolean;
  /** Struck through and left in place, so the slot stays visible as a slot. */
  unavailable?: boolean;
}

/** `.time-opt` — one row. Tabular figures, so the column of times does not
 *  jitter, and a check marks the chosen one.
 *
 *  Selected takes the quiet neutral rather than the primary fill a calendar day
 *  gets: a time list is a plain menu of choices, a calendar day is a value being
 *  committed. Note that `.time-opt.on` is a filled region — it re-points BOTH
 *  support tones at --color-fg-on-fill for everything inside it, so a `.time-zone`
 *  nested here follows automatically. */
export function TimeOption({
  selected,
  unavailable,
  className,
  children,
  ...rest
}: TimeOptionProps) {
  return (
    <div
      role="option"
      aria-selected={Boolean(selected)}
      aria-disabled={unavailable || undefined}
      className={cx('time-opt', selected && 'on', unavailable && 'off', className)}
      {...rest}
    >
      {children}
      {selected && <Icon name="check" size="sm" />}
    </div>
  );
}

/** `.time-zone` — the quiet caption beside a time, in a field's message row. It
 *  exists so the zone is stated once rather than repeated on every option. */
export function TimeZone({ className, children, ...rest }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={cx('time-zone', className)} {...rest}>
      {children}
    </span>
  );
}