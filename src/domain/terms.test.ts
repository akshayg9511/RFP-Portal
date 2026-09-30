import { describe, expect, it } from "vitest";
import { termsFromValues } from "./terms";

/**
 * The regression guard for a confirmed data-loss bug.
 *
 * The quote form writes the commercial terms into the generic `values` JSON,
 * because that is where the template's additionalInformation section puts every
 * line. They also have typed columns, which the Playground needs to query.
 * Nothing mapped between the two — and the PUT wrote `moq: body.moq ?? null`
 * against a body that never carried it, so `undefined ?? null` nulled all four
 * columns on EVERY save. Including `dutyType`, which decides whether a bid is
 * DDP and therefore silently changed its Best Cost.
 */

describe("termsFromValues", () => {
  it("maps the template's keys onto their typed columns", () => {
    const t = termsFromValues({
      maxVolumeCapacity: "380000",
      productionLeadTime: "45",
      moq: "2400",
      additionalNotes: "Ships from Ningbo.",
    });
    expect(t).toEqual({
      maxVolumeCapacity: 380_000,
      productionLeadTime: 45,
      moq: 2400,
      notes: "Ships from Ningbo.",
    });
  });

  it("renames additionalNotes to notes", () => {
    // The trap: template key and column name disagree. Renaming the template
    // key instead would orphan text already stored under the old key.
    expect(termsFromValues({ additionalNotes: "hello" }).notes).toBe("hello");
    expect(termsFromValues({ notes: "wrong key" }).notes).toBeNull();
  });

  it("a blank field is null, not zero", () => {
    // A vendor who left MOQ empty has not declared "no minimum".
    const t = termsFromValues({ moq: "", maxVolumeCapacity: "   " });
    expect(t.moq).toBeNull();
    expect(t.maxVolumeCapacity).toBeNull();
  });

  it("rejects a negative term rather than storing it", () => {
    const t = termsFromValues({ moq: "-500", productionLeadTime: "-1" });
    expect(t.moq).toBeNull();
    expect(t.productionLeadTime).toBeNull();
  });

  it("ignores junk rather than storing NaN", () => {
    expect(termsFromValues({ moq: "abc" }).moq).toBeNull();
  });

  it("rounds a decimal — these are counts, not measures", () => {
    expect(termsFromValues({ moq: "2400.6" }).moq).toBe(2401);
  });

  it("an explicit body field beats the values blob", () => {
    // So an Excel upload or an API client can set a column directly.
    const t = termsFromValues({ moq: "2400" }, { moq: 999 });
    expect(t.moq).toBe(999);
  });

  it("an empty values blob yields all nulls, never undefined", () => {
    // undefined would let Prisma leave the column untouched in an update,
    // which sounds harmless but makes the result depend on prior state.
    const t = termsFromValues({});
    expect(t).toEqual({
      maxVolumeCapacity: null,
      productionLeadTime: null,
      moq: null,
      notes: null,
    });
  });
});
