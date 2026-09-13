'use client';

/* Class-name joiner. Falsy entries drop out, so a conditional modifier reads
   cx('btn', variant && `btn--${variant}`, size, disabled && 'is-off'). */
export type ClassValue = string | false | null | undefined;

export function cx(...parts: ClassValue[]): string {
  return parts.filter(Boolean).join(' ');
}