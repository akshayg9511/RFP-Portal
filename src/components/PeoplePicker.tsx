"use client";

import * as React from "react";
import { Token, TokenField } from "@/ds/components";

/**
 * Pick several people (or vendors) from a list the backend supplies.
 *
 * Used for an RFP's Sourcing partners and GMs, which became lists in UX v2,
 * and for nominating vendors at create time. Chosen values are removable
 * tokens; the remaining options sit in one "Add …" select, so the field
 * never offers something already picked and never accepts free text — the
 * list is the backend's to own.
 */
export function PeoplePicker({
  id,
  label,
  options,
  value,
  onChange,
  addLabel,
  format,
  hint,
}: {
  id: string;
  label: string;
  options: string[];
  value: string[];
  onChange: (next: string[]) => void;
  /** Placeholder for the add control, e.g. "Add sourcing partner". */
  addLabel: string;
  /** Display text for a stored value, e.g. a vendor id → its name. */
  format?: (v: string) => string;
  hint?: string;
}) {
  const remaining = options.filter((o) => !value.includes(o));
  const show = (v: string) => (format ? format(v) : v);

  return (
    <div className="field">
      <label className="lbl" htmlFor={id}>
        {label}
      </label>
      <TokenField className="pp-field">
        {value.map((v) => (
          <Token
            key={v}
            onDismiss={() => onChange(value.filter((x) => x !== v))}
            dismissLabel={`Remove ${show(v)}`}
          >
            {show(v)}
          </Token>
        ))}
        <select
          id={id}
          className="pp-add"
          value=""
          disabled={!remaining.length}
          onChange={(e) => {
            if (e.target.value) onChange([...value, e.target.value]);
          }}
        >
          <option value="">{remaining.length ? `+ ${addLabel}` : "Everyone added"}</option>
          {remaining.map((o) => (
            <option key={o} value={o}>
              {show(o)}
            </option>
          ))}
        </select>
      </TokenField>
      {hint ? <div className="msg">{hint}</div> : null}
    </div>
  );
}
