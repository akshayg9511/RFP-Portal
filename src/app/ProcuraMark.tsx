/**
 * The Procura mark.
 *
 * Three bars converging on a single point — many vendors bidding, one award.
 * It reads as a "P" counter at a glance and as the sourcing funnel on a second
 * look, which is the right order for a mark that sits in chrome.
 *
 * currentColor throughout, so it inherits whatever the tile sets.
 */
export function ProcuraMark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      role="img"
      aria-label="Procura"
    >
      {/* Three lanes in, converging. */}
      <path
        d="M3 5h9a5 5 0 0 1 0 10H8"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      {/* The stem — the decision the lanes resolve into. */}
      <path
        d="M6 15v5"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      {/* The award point. */}
      <circle cx="17" cy="19" r="2.1" fill="currentColor" />
    </svg>
  );
}
