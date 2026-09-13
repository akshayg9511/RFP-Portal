'use client';

import * as React from 'react';
import { cx } from './cx';
import { Icon } from './Icon';

export type TokenVariant = 'removable' | 'static' | 'disabled';

export interface TokenProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** Qualifier — "Status: is". Quieter than the value it introduces. */
  qualifier?: React.ReactNode;
  /** The value. Truncates with an ellipsis rather than growing the token. */
  children: React.ReactNode;
  /** Entry failed validation — still removable, because a bad token the user
   *  cannot delete is a dead end. */
  danger?: boolean;
  /** removable (default) — carries its own dismiss.
   *  static — system-set, no dismiss at all.
   *  disabled — present but not editable. The dismiss STAYS and is disabled
   *    (`.token.disabled button.x` is a real rule); only `static` drops it,
   *    because a system-set value was never the user's to remove.
   *  One axis, not two booleans: Figma models this as `Variant`, and
   *  `.token.static.disabled` is not a rule the system defines. `tone` stays
   *  separate — it is genuinely orthogonal (Figma gives it its own axis). */
  variant?: TokenVariant;
  onDismiss?: () => void;
  /** Names the dismiss. Required when onDismiss is set — "Remove northwind",
   *  never a bare "Remove". */
  dismissLabel?: string;
}

/** `.token` — a committed criterion or value, carrying its own dismiss. */
export const Token = React.forwardRef<HTMLSpanElement, TokenProps>(function Token(
  { qualifier, children, danger, variant = 'removable', onDismiss, dismissLabel, className, ...rest },
  ref,
) {
  const showX = Boolean(onDismiss) && variant !== 'static';
  return (
    <span
      ref={ref}
      className={cx('token', danger && 'token--danger', variant !== 'removable' && variant, className)}
      {...rest}
    >
      {qualifier != null && <span className="key">{qualifier}</span>}
      <span className="lbl">{children}</span>
      {showX && (
        <button
          type="button"
          className="x"
          aria-label={dismissLabel ?? 'Remove'}
          disabled={variant === 'disabled'}
          onClick={onDismiss}
        >
          <Icon name="close" />
        </button>
      )}
    </span>
  );
});

export interface TokenFieldProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Field-level error border. Pair with a `.msg.err` under the field — the
   *  field failed a rule about its contents, so marking every token red would
   *  say each one is wrong. */
  invalid?: boolean;
}

/** `.token-field` — the wrapping input the tokens live in. Draws its own
 *  border, so it is NOT wrapped in a `<Control>`. */
export function TokenField({ invalid, className, children, ...rest }: TokenFieldProps) {
  return (
    <div className={cx('token-field', invalid && 'invalid', className)} {...rest}>
      {children}
    </div>
  );
}