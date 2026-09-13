'use client';

import * as React from 'react';
import { cx } from './cx';
import { Icon } from './Icon';

/* ── CONTROL ───────────────────────────────────────────────
   `.control` IS the input box — the border, the height, the padding.
   It wraps a bare <input>, <textarea>, or an affix. It must NEVER wrap a
   <Select> or anything else that draws its own border: that nests a border
   inside a border and reads as a dropdown sitting in a text field.
   QDS_LINT() flags it ("A self-bordered control inside a .control"). */

/* Validity and availability are ONE axis, not three booleans. The CSS never
   combines them — `.control.invalid`, `.control.readonly` and `.control.disabled`
   only ever pair with a pseudo-class (`.control.invalid:hover`,
   `.control.readonly:hover`) — and Figma flattens all three into a single State
   axis. `<Control invalid readOnly disabled>` used to typecheck and emit three
   competing classes for a state the system does not define.
   Hover and focus are deliberately absent: they are transient pseudo-states the
   CSS owns, and a prop for them lets the render disagree with the pointer. */
export type ControlState = 'invalid' | 'readonly' | 'disabled';

export interface ControlProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Toolbar rung — --size-control-sm, matching Select `sm` and Button `sm`.
   *  A bar picks ONE rung and every bordered control in it takes that rung. */
  sm?: boolean;
  /** invalid — failed validation, the message says which rule.
   *  readonly — readable and copyable, NOT editable; stays focusable and in the
   *    tab order, unlike disabled, which removes it from both.
   *  disabled — unavailable, out of the tab order. */
  state?: ControlState;
  textarea?: boolean;
  stepper?: boolean;
}

export const Control = React.forwardRef<HTMLDivElement, ControlProps>(
  function Control({ sm, state, textarea, stepper, className, children, ...rest }, ref) {
    return (
      <div
        ref={ref}
        className={cx(
          'control',
          sm && 'sm',
          state,
          textarea && 'textarea',
          stepper && 'stepper',
          className,
        )}
        {...rest}
      >
        {children}
      </div>
    );
  },
);

/* ── AFFIX ─────────────────────────────────────────────────
   Leading or trailing unit, currency, or glyph, so the user types only the
   value. Never type the unit into the value itself. */
export interface AffixProps extends React.HTMLAttributes<HTMLSpanElement> {}

export function Affix({ className, children, ...rest }: AffixProps) {
  return (
    <span className={cx('affix', className)} {...rest}>
      {children}
    </span>
  );
}

/* ── MESSAGE ───────────────────────────────────────────────
   Helper OR error — never both. The error REPLACES the helper while showing;
   stacking them makes the user read two rules to find the broken one. */
export interface FieldMessageProps extends React.HTMLAttributes<HTMLDivElement> {
  error?: boolean;
}

export function FieldMessage({ error, className, children, ...rest }: FieldMessageProps) {
  return (
    <div className={cx('msg', error && 'err', className)} {...rest}>
      {/* Decorative: the sentence carries the meaning. Centred on the FIRST
          line by the CSS, so a wrapped error still starts the eye at the glyph. */}
      {error && <Icon name="alert_circle" size="sm" filled />}
      {children}
    </div>
  );
}

/* ── FIELD ─────────────────────────────────────────────────
   The column: label, control, message, at --field-gap. Separation BETWEEN
   fields is --form-field-gap and belongs to the container (.form, or a
   .drawer-b / .modal-b holding fields directly) — never a margin here. */

export interface FieldProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  label: React.ReactNode;
  /** Ties <label for> to the control's id. Generated when omitted. */
  htmlFor?: string;
  /** true → danger asterisk. false → a subtle "(optional)". Pick ONE
   *  convention per form and mark the minority; never both. */
  required?: boolean | null;
  /** Helper text. Replaced by `error` when that is set. */
  help?: React.ReactNode;
  error?: React.ReactNode;
  /** Renders beside the message on a `.msg-row`. */
  counter?: React.ReactNode;
  /** true turns the counter danger. */
  counterOver?: boolean;
  /** Receives the wired id + aria attributes to spread onto the real control. */
  children: (props: {
    id: string;
    'aria-describedby': string | undefined;
    'aria-invalid': true | undefined;
    required: boolean | undefined;
  }) => React.ReactNode;
}

export function Field({
  label,
  htmlFor,
  required,
  help,
  error,
  counter,
  counterOver,
  className,
  children,
  ...rest
}: FieldProps) {
  const auto = React.useId();
  const id = htmlFor ?? auto;
  const msgId = `${id}-msg`;
  const hasMsg = Boolean(error ?? help);

  return (
    <div className={cx('field', className)} {...rest}>
      <label htmlFor={id}>
        {label}
        {required === true && <span className="req">*</span>}
        {required === false && <span className="optional">(optional)</span>}
      </label>

      {children({
        id,
        'aria-describedby': hasMsg ? msgId : undefined,
        'aria-invalid': error ? true : undefined,
        // The attribute, not only the asterisk — the asterisk is not announced.
        required: required === true ? true : undefined,
      })}

      {hasMsg &&
        (counter != null ? (
          <div className="msg-row">
            <FieldMessage error={Boolean(error)} id={msgId}>
              {error ?? help}
            </FieldMessage>
            <span className={cx('count', counterOver && 'over')}>{counter}</span>
          </div>
        ) : (
          <FieldMessage error={Boolean(error)} id={msgId}>
            {error ?? help}
          </FieldMessage>
        ))}
    </div>
  );
}