/**
 * Display formatting. One place, so a dollar reads the same on every screen.
 */

/** $1.2M · $340K · $8.73 — scale chosen so a figure stays scannable. */
export function money(value: number | null | undefined, dp = 2): string {
  if (value === null || value === undefined) return "—";

  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `$${Math.round(value / 1000)}K`;
  return `$${value.toFixed(dp)}`;
}

/** Always to the cent — for a unit cost, where rounding to $1.2M is wrong. */
export function unitCost(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `$${value.toFixed(2)}`;
}

export function units(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString("en-US");
}

export function percent(value: number | null | undefined, dp = 1): string {
  if (value === null || value === undefined) return "—";
  return `${(value * 100).toFixed(dp)}%`;
}

/** Title-cases a CONSTANT_CASE key for display. */
export function label(value: string): string {
  return value
    .split("_")
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(" ");
}
