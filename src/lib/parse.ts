/**
 * Value parsing for spreadsheet ingest.
 *
 * Written once and used by BOTH the seed script and the vendor Excel upload
 * (M1b), because they face the same problem: every value arriving from a
 * spreadsheet is a string, money carries "$", and thousands carry ",".
 *
 * No framework imports — this is domain-adjacent and must stay portable.
 */

/** "$70.46" -> 70.46 · "1,770" -> 1770 · "" / null / "N/A" -> null */
export function money(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  const cleaned = String(value).replace(/[$,\s]/g, "").trim();
  if (!cleaned || isExcelError(cleaned)) return null;

  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Same cleaning, rounded to a whole number. */
export function int(value: unknown): number | null {
  const n = money(value);
  return n === null ? null : Math.round(n);
}

/** Trimmed string, or null for blanks and Excel error values. */
export function str(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s || isExcelError(s)) return null;
  return s;
}

/** "a.jpg,b.jpg" -> ["a.jpg", "b.jpg"]. Empty entries dropped. */
export function list(value: unknown, separator = ","): string[] {
  const s = str(value);
  if (!s) return [];
  return s
    .split(separator)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * HTSUS codes arrive float-formatted ("1604310000.0") on both sides of the
 * tariff join. Without stripping the suffix, nothing matches.
 */
export function htsCode(value: unknown): string | null {
  const s = str(value);
  if (!s) return null;
  return s.replace(/\.0+$/, "");
}

/**
 * Country of origin arrives in two shapes: a bare ISO ("CN") and a
 * "Name | ISO" pair ("India | IN"). Take the last token either way.
 *
 * "System default (India)" is a placeholder rather than an observation. It is
 * aliased explicitly, and kept visible here rather than buried, because it is
 * an assumption and not data.
 */
export function countryIso(value: unknown): string | null {
  const s = str(value);
  if (!s) return null;

  if (/^system default/i.test(s)) {
    const inner = s.match(/\(([^)]+)\)/)?.[1];
    return inner ? countryNameToIso(inner) : null;
  }

  const last = s.split("|").pop()?.trim() ?? "";
  if (/^[A-Za-z]{2}$/.test(last)) return last.toUpperCase();
  return countryNameToIso(last);
}

const COUNTRY_ISO: Record<string, string> = {
  china: "CN",
  india: "IN",
  "viet nam": "VN",
  vietnam: "VN",
  cambodia: "KH",
  bangladesh: "BD",
  indonesia: "ID",
  thailand: "TH",
  bahrain: "BH",
  mexico: "MX",
  jordan: "JO",
  "sri lanka": "LK",
  pakistan: "PK",
  turkey: "TR",
  italy: "IT",
  portugal: "PT",
  peru: "PE",
  guatemala: "GT",
  lesotho: "LS",
  "united states": "US",
};

export function countryNameToIso(name: string): string | null {
  return COUNTRY_ISO[name.trim().toLowerCase()] ?? null;
}

/**
 * COO region — the grain every guardrail is measured on (Build Doc 11.8).
 * Returns null rather than guessing, so an unmapped country is visible as
 * "not declared" instead of silently joining a region and moving a threshold.
 */
export type CooRegion = "CHINA" | "SEA" | "ISC" | "AMERICAS" | "EMEA";

const ISO_REGION: Record<string, CooRegion> = {
  CN: "CHINA",
  HK: "CHINA",
  TW: "CHINA",
  VN: "SEA",
  KH: "SEA",
  TH: "SEA",
  ID: "SEA",
  MY: "SEA",
  PH: "SEA",
  MM: "SEA",
  IN: "ISC",
  BD: "ISC",
  LK: "ISC",
  PK: "ISC",
  NP: "ISC",
  US: "AMERICAS",
  MX: "AMERICAS",
  PE: "AMERICAS",
  GT: "AMERICAS",
  BR: "AMERICAS",
  CO: "AMERICAS",
  DO: "AMERICAS",
  CA: "AMERICAS",
  TR: "EMEA",
  IT: "EMEA",
  PT: "EMEA",
  ES: "EMEA",
  BG: "EMEA",
  MA: "EMEA",
  EG: "EMEA",
  JO: "EMEA",
  BH: "EMEA",
  AE: "EMEA",
  LS: "EMEA",
  KE: "EMEA",
};

export function cooRegion(iso: string | null): CooRegion | null {
  if (!iso) return null;
  return ISO_REGION[iso.toUpperCase()] ?? null;
}

/** Excel error literals that must never be cast to a number. */
function isExcelError(s: string): boolean {
  return /^#(REF|N\/A|VALUE|DIV\/0|NAME|NULL|NUM)/i.test(s);
}
