import { describe, expect, it } from "vitest";
import {
  cooRegion,
  countryIso,
  htsCode,
  int,
  list,
  money,
  str,
} from "./parse";

describe("money", () => {
  it("strips currency and thousands separators", () => {
    expect(money("$70.46")).toBe(70.46);
    expect(money("1,770")).toBe(1770);
    expect(money("$1,234.56")).toBe(1234.56);
  });

  it("passes numbers through", () => {
    expect(money(8.5)).toBe(8.5);
  });

  it("returns null for blanks and Excel errors", () => {
    expect(money("")).toBeNull();
    expect(money(null)).toBeNull();
    expect(money("#REF!")).toBeNull();
    expect(money("#N/A")).toBeNull();
  });

  it("returns null rather than NaN for junk", () => {
    expect(money("not a number")).toBeNull();
  });
});

describe("int", () => {
  it("rounds", () => {
    expect(int("1,770")).toBe(1770);
    expect(int("29,785.4")).toBe(29785);
  });
});

describe("str", () => {
  it("trims and nulls blanks", () => {
    expect(str("  Ponte  ")).toBe("Ponte");
    expect(str("   ")).toBeNull();
    expect(str("#N/A")).toBeNull();
  });
});

describe("list", () => {
  it("splits and trims, dropping empties", () => {
    expect(list("a.jpg,b.jpg")).toEqual(["a.jpg", "b.jpg"]);
    expect(list("a.jpg, ,b.jpg")).toEqual(["a.jpg", "b.jpg"]);
    expect(list("")).toEqual([]);
  });
});

describe("htsCode", () => {
  // Without this the tariff join matches nothing.
  it("strips the float suffix", () => {
    expect(htsCode("1604310000.0")).toBe("1604310000");
    expect(htsCode("6104692030")).toBe("6104692030");
  });
});

describe("countryIso", () => {
  it("handles both source formats", () => {
    expect(countryIso("CN")).toBe("CN");
    expect(countryIso("India | IN")).toBe("IN");
    expect(countryIso("Viet Nam")).toBe("VN");
  });

  it("aliases the System default placeholder", () => {
    expect(countryIso("System default (India)")).toBe("IN");
  });

  it("returns null rather than guessing", () => {
    expect(countryIso("Atlantis")).toBeNull();
    expect(countryIso("")).toBeNull();
  });
});

describe("cooRegion", () => {
  it("maps the five regions", () => {
    expect(cooRegion("CN")).toBe("CHINA");
    expect(cooRegion("VN")).toBe("SEA");
    expect(cooRegion("IN")).toBe("ISC");
    expect(cooRegion("MX")).toBe("AMERICAS");
    expect(cooRegion("JO")).toBe("EMEA");
  });

  it("returns null for unmapped, so a guardrail is never silently moved", () => {
    expect(cooRegion("ZZ")).toBeNull();
    expect(cooRegion(null)).toBeNull();
  });
});
