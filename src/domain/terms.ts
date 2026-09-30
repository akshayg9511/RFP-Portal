/**
 * Commercial terms: the template's additionalInformation section -> typed
 * columns. Pure, no framework imports, so it ports with the rest of domain/.
 *
 * The terms live in the template's `additionalInformation` section,
 * so the form writes them into the generic `values` JSON like any other line.
 * They ALSO have typed columns, because the Playground and the vendor drill-down
 * need to query them.
 *
 * Nothing mapped between the two. The form sent only values/bucketTotals/fob/
 * status, and the PUT wrote `moq: body.moq ?? null` — so `undefined ?? null`
 * nulled all four typed columns on EVERY save, including `dutyType`, which is
 * what marks a bid as DDP and therefore silently changed its Best Cost.
 *
 * One more trap: the template's key is `additionalNotes`, the column is `notes`.
 */
const TERM_KEYS = {
  maxVolumeCapacity: "maxVolumeCapacity",
  productionLeadTime: "productionLeadTime",
  moq: "moq",
  // The rename. Renaming the template key instead would orphan the text already
  // stored under `additionalNotes` in existing quotes.
  additionalNotes: "notes",
} as const;

type Terms = {
  maxVolumeCapacity: number | null;
  productionLeadTime: number | null;
  moq: number | null;
  notes: string | null;
};

/**
 * Values come off the DOM as strings, so a blank field is "" and must become
 * null rather than 0 — a vendor who left MOQ empty has not said "no minimum".
 * Explicit body fields win over the values blob, so an Excel upload or an API
 * client can set them directly.
 */
export function termsFromValues(
  values: Record<string, unknown>,
  body: Partial<Terms> = {},
): Terms {
  const int = (raw: unknown): number | null => {
    if (raw === undefined || raw === null) return null;
    // Trim first: Number("   ") is 0, not NaN, so a field holding only spaces
    // would have stored a capacity of zero.
    if (typeof raw === "string" && raw.trim() === "") return null;
    const n = Number(raw);
    // Negative capacity or lead time is not a value anyone meant to enter.
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
  };

  const out = {} as Terms;
  for (const [valueKey, column] of Object.entries(TERM_KEYS)) {
    const fromBody = (body as Record<string, unknown>)[column];
    const raw = fromBody !== undefined ? fromBody : values[valueKey];
    if (column === "notes") {
      out.notes = typeof raw === "string" && raw.trim() ? raw.trim() : null;
    } else {
      (out as Record<string, number | null>)[column] = int(raw);
    }
  }
  return out;
}
