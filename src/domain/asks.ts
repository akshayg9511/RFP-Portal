/**
 * Asks — anchored, typed, stateful, resolvable. They replace chat (Build Doc 7).
 *
 * The mechanic that makes this more than a comment box: AN ASK ANCHORED TO A
 * VALUE AUTO-MARKS ADDRESSED WHEN THAT VALUE CHANGES, recording before and
 * after. Nobody has to click anything, and nobody has to chase. A comment
 * thread requires both sides to remember what was asked; this does not.
 *
 * Pure functions, no framework imports — the state machine is the part that
 * must not drift, so it lives here and is tested without a database.
 */

export type AskAnchor = "RFP" | "PRODUCT" | "PRODUCT_BUCKET" | "PRODUCT_FIELD";

/**
 * REDUCE and CLARIFY come from procurement. FILL and FIX are raised by the
 * system against a blank mandatory input or a wrong unit — kept in the type
 * union because the schema declares them, though only REDUCE and CLARIFY are
 * raised in this build.
 */
export type AskType = "REDUCE" | "CLARIFY" | "FILL" | "FIX";

/**
 * OPEN -> ADDRESSED happens by itself, on a value change.
 * ADDRESSED -> RESOLVED or REOPENED is procurement's judgement: the vendor
 * moved the number, but only a human decides whether far enough.
 */
export type AskStatus = "OPEN" | "ADDRESSED" | "RESOLVED" | "REOPENED";

export type Ask = {
  id: string;
  anchor: AskAnchor;
  styleId: string | null;
  bucket: string | null;
  fieldPath: string | null;
  type: AskType;
  body: string | null;
  targetPctLo: number | null;
  targetPctHi: number | null;
  status: AskStatus;
  mandatory: boolean;
  valueBefore: string | null;
  valueAfter: string | null;
};

/** What an Ask watches. A bucket Ask watches its bucket total. */
export type WatchedValues = {
  /** Bucket key -> total, as stored on the quote. */
  buckets: Record<string, number>;
  /** Line-item key -> raw value, as the vendor typed it. */
  fields: Record<string, unknown>;
};

/**
 * The value an Ask is anchored to, as a comparable string. Null when the Ask
 * watches nothing specific — an RFP- or PRODUCT-level Ask is a question, not a
 * number, so it can never auto-address.
 */
export function watchedValue(
  ask: Pick<Ask, "anchor" | "bucket" | "fieldPath">,
  values: WatchedValues,
): string | null {
  if (ask.anchor === "PRODUCT_BUCKET" && ask.bucket) {
    const total = values.buckets[ask.bucket];
    return total === undefined ? null : String(round4(total));
  }
  if (ask.anchor === "PRODUCT_FIELD" && ask.fieldPath) {
    const raw = values.fields[ask.fieldPath];
    if (raw === undefined || raw === null || raw === "") return null;
    // Numbers compare as numbers: "2.50" and "2.5" are the same answer, and
    // flagging that as a change would cry wolf.
    const n = Number(raw);
    return Number.isFinite(n) ? String(round4(n)) : String(raw);
  }
  return null;
}

/**
 * Applied after a vendor saves. Returns only the Asks whose watched value
 * actually moved, with the transition to write.
 *
 * Deliberate rules:
 *
 *   A RESOLVED Ask stays resolved. Procurement closed it; a later edit to the
 *   same field must not silently reopen a settled question.
 *
 *   An ADDRESSED Ask re-addresses on a further change, updating `valueAfter`.
 *   The vendor moving twice is still "the vendor has responded".
 *
 *   `valueBefore` is captured ONCE, at the first change, so the pair always
 *   reads "what it was when we asked" -> "what it is now". Overwriting it on
 *   every edit would lose the original.
 */
export function addressedByChange(
  asks: Ask[],
  values: WatchedValues,
): { id: string; status: AskStatus; valueBefore: string | null; valueAfter: string }[] {
  const out: {
    id: string;
    status: AskStatus;
    valueBefore: string | null;
    valueAfter: string;
  }[] = [];

  for (const ask of asks) {
    if (ask.status === "RESOLVED") continue;

    const now = watchedValue(ask, values);
    if (now === null) continue;

    // The reference point: what it was when the Ask was raised, or at the last
    // recorded change.
    const reference = ask.valueBefore ?? ask.valueAfter;
    if (reference === null || reference === undefined) {
      // Nothing to compare against — record the current value as the baseline
      // without claiming the vendor has responded.
      continue;
    }
    if (reference === now) continue;

    out.push({
      id: ask.id,
      status: "ADDRESSED",
      valueBefore: ask.valueBefore ?? reference,
      valueAfter: now,
    });
  }

  return out;
}

/**
 * The target as a sentence. A REDUCE Ask carries a percentage range, and the
 * vendor must be told the target in the same terms procurement set it — never a
 * derived absolute price, which would hand them the should-cost figure.
 */
export function targetLabel(
  ask: Pick<Ask, "type" | "targetPctLo" | "targetPctHi">,
): string | null {
  if (ask.type !== "REDUCE") return null;
  const lo = ask.targetPctLo;
  const hi = ask.targetPctHi;
  if (lo === null && hi === null) return null;
  if (lo !== null && hi !== null) {
    return lo === hi
      ? `reduce by ${fmtPct(lo)}`
      : `reduce by ${fmtPct(lo)}–${fmtPct(hi)}`;
  }
  return `reduce by at least ${fmtPct((lo ?? hi) as number)}`;
}

/** Counts for a per-product rail. Resolved is done; the rest still need eyes. */
export function askSummary(asks: Pick<Ask, "status">[]): {
  open: number;
  addressed: number;
  resolved: number;
  outstanding: number;
} {
  const open = asks.filter((a) => a.status === "OPEN" || a.status === "REOPENED").length;
  const addressed = asks.filter((a) => a.status === "ADDRESSED").length;
  const resolved = asks.filter((a) => a.status === "RESOLVED").length;
  return { open, addressed, resolved, outstanding: open + addressed };
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

function fmtPct(n: number): string {
  // Whole numbers read as targets; decimals read as calculations.
  return Number.isInteger(n) ? `${n}%` : `${n.toFixed(1)}%`;
}
