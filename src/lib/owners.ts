/**
 * RFP owners as lists (UX v2).
 *
 * An RFP can have several sourcing partners and several GMs. They live in the
 * JSON columns `sourcingPartners` / `gms`; the original single columns are
 * kept and dual-written with the FIRST entry, so anything still reading
 * `sourcingPartner` / `gm` (bid summary, vendor dashboard) keeps working.
 */

/** Read a list column, falling back to the single column for old rows. */
export function ownerList(list: unknown, single: string | null | undefined): string[] {
  if (Array.isArray(list)) {
    return list.filter((v): v is string => typeof v === "string" && v.trim() !== "");
  }
  return single ? [single] : [];
}

/** Normalise user input: trimmed, de-duplicated, empties dropped. */
export function cleanOwners(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const v of input) {
    if (typeof v !== "string") continue;
    const t = v.trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/** Prisma data for writing both owner lists plus their single-column mirrors. */
export function ownersData(partners: string[] | undefined, gms: string[] | undefined) {
  return {
    ...(partners !== undefined
      ? { sourcingPartners: partners, sourcingPartner: partners[0] ?? null }
      : {}),
    ...(gms !== undefined ? { gms, gm: gms[0] ?? null } : {}),
  };
}

/** Prisma data for the procurement-owner list (no single-column mirror). */
export function procurementData(owners: string[] | undefined) {
  return owners !== undefined ? { procurementOwners: owners } : {};
}
