'use client';

import * as React from 'react';
import { cx } from './cx';

/* ── META LIST ─────────────────────────────────────────────
   A record's FACTS — the things it is, rather than the things you may change
   about it. Until Phase 8 this system had no vehicle for them, so a static value
   shipped as a readonly <input>: a bordered 44px box with a fill, which is the
   shape Quince uses to say "type here".

   READONLY IS A FORM STATE AND STAYS ONE. <Control state="readonly"> is correct
   for a field that PARTICIPATES in the form — focusable, copyable, not editable,
   and submitted with everything else. The test is whether the value would be
   carried back: if nothing would submit it, it is a fact about the record and
   belongs here.

   It renders a real <dl>. The spec calls that "an association list consisting of
   zero or more name-value groups", which is exactly this object, and dt/dd hand a
   listener the pairing that a readonly input cannot. The <div> around each pair
   is valid inside a dl and is what lets a pair be one flex item. */

export interface MetaListProps extends React.HTMLAttributes<HTMLDListElement> {
  /** Multi-column, wrapping — the same 200px basis `.form.h` gives a field, so a
   *  section mixing facts and fields lands on ONE column grid. One column on a
   *  phone is that row wrapping, not a width rule: there is nothing to configure
   *  and nothing keyed to a viewport. */
  h?: boolean;
}

export function MetaList({ h, className, children, ...rest }: MetaListProps) {
  return (
    <dl className={cx('meta-list', h && 'h', className)} {...rest}>
      {children}
    </dl>
  );
}

export interface MetaItemProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  label: React.ReactNode;
  /** Tabular figures — money, dates, IDs, counts. A value read as a QUANTITY,
   *  where a column of them should line up. Prose does not take it. */
  num?: boolean;
  /** The value. Nullish or an empty string renders the absent treatment: an em
   *  dash in subtle ink, which says the fact exists and holds nothing where a
   *  blank line says the row failed to render.
   *  WHERE THE ABSENCE ITSELF MEANS SOMETHING — "no PO matched yet" — pass that
   *  string instead. A dash is announced as an em dash or as nothing, and this
   *  system deliberately has no `.sr-only` utility to hide a better word behind,
   *  so the dash is for an absence nobody needs told about.
   *  An interactive value stays interactive: pass a <Link>, and a state value a
   *  <Badge>. Neither needs a prop here — they are themselves inside the dd. */
  children?: React.ReactNode;
  /** A line about where the value came from — "Received through the supplier
   *  portal" under a timestamp. It renders INSIDE the dd, one rung down and
   *  muted, not as a second <dd>: two dds under one dt says the name has two
   *  VALUES, which is a different claim. Use it only where a record genuinely
   *  needs it; a note on every fact is a form's helper text arriving somewhere
   *  it was not invited. */
  note?: React.ReactNode;
}

export function MetaItem({ label, num, note, className, children, ...rest }: MetaItemProps) {
  const absent = children == null || children === '';
  return (
    <div className={cx('meta-item', className)} {...rest}>
      <dt>{label}</dt>
      <dd className={cx(absent && 'none', num && !absent && 'num')}>
        {absent ? '—' : children}
        {note != null && <span className="sub">{note}</span>}
      </dd>
    </div>
  );
}