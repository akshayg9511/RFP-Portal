/**
 * The Procura mark (Open Questions 06): a dark tile carrying a blue stem and
 * an orange bowl — the "P".
 *
 * Brand ARTWORK, so its two inks are fixed rather than themed: the stem is the
 * foundation's cobalt-400 and the bowl the mark's own orange. The tile behind
 * it is `.pn-brand-mark`, a neutral plate that sits one step up from the nav.
 */
export function ProcuraMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" role="img" aria-label="Procura">
      {/* The stem. */}
      <rect x="7" y="7" width="7" height="18" rx="1.5" fill="var(--ref-color-cobalt-400)" />
      {/* The bowl. A logo ink, not a UI colour — no token carries it. */}
      <circle cx="21" cy="12.5" r="5.5" fill="#F7A072" />
    </svg>
  );
}
