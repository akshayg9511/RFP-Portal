import { describe, expect, it } from "vitest";
import {
  addressedByChange,
  askSummary,
  targetLabel,
  watchedValue,
  type Ask,
} from "./asks";

/**
 * The auto-address mechanic is the whole reason Asks are not a comment box, so
 * it is the part that gets pinned hardest.
 */

const base: Ask = {
  id: "a1",
  anchor: "PRODUCT_BUCKET",
  styleId: "s1",
  bucket: "BASE_MATERIALS",
  fieldPath: null,
  type: "REDUCE",
  body: "Your fabric cost is above our model.",
  targetPctLo: 8,
  targetPctHi: 12,
  status: "OPEN",
  mandatory: false,
  valueBefore: "13.8",
  valueAfter: null,
};

const values = (buckets: Record<string, number>, fields: Record<string, unknown> = {}) => ({
  buckets,
  fields,
});

describe("watchedValue", () => {
  it("a bucket Ask watches its bucket total", () => {
    expect(watchedValue(base, values({ BASE_MATERIALS: 12.6 }))).toBe("12.6");
  });

  it("a field Ask watches its line item", () => {
    const ask = { ...base, anchor: "PRODUCT_FIELD" as const, bucket: null, fieldPath: "consumption" };
    expect(watchedValue(ask, values({}, { consumption: "2.40" }))).toBe("2.4");
  });

  it("compares numbers as numbers, so 2.50 and 2.5 are the same answer", () => {
    // Otherwise a reformat would read as a response.
    const ask = { ...base, anchor: "PRODUCT_FIELD" as const, bucket: null, fieldPath: "x" };
    expect(watchedValue(ask, values({}, { x: "2.50" }))).toBe(
      watchedValue(ask, values({}, { x: 2.5 })),
    );
  });

  it("an RFP- or PRODUCT-level Ask watches nothing", () => {
    // A question is not a number, so it can never auto-address.
    expect(watchedValue({ ...base, anchor: "RFP" }, values({ BASE_MATERIALS: 1 }))).toBeNull();
    expect(watchedValue({ ...base, anchor: "PRODUCT" }, values({ BASE_MATERIALS: 1 }))).toBeNull();
  });

  it("a blank field is not a value", () => {
    const ask = { ...base, anchor: "PRODUCT_FIELD" as const, bucket: null, fieldPath: "x" };
    expect(watchedValue(ask, values({}, { x: "" }))).toBeNull();
  });
});

describe("addressedByChange — the mechanic", () => {
  it("marks ADDRESSED when the watched value moves, with before and after", () => {
    const out = addressedByChange([base], values({ BASE_MATERIALS: 12.6 }));
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      id: "a1",
      status: "ADDRESSED",
      valueBefore: "13.8",
      valueAfter: "12.6",
    });
  });

  it("does nothing when the value has not moved", () => {
    expect(addressedByChange([base], values({ BASE_MATERIALS: 13.8 }))).toHaveLength(0);
  });

  it("a RESOLVED Ask stays resolved", () => {
    // Procurement closed it. A later edit to the same field must not silently
    // reopen a settled question.
    const resolved = { ...base, status: "RESOLVED" as const, valueAfter: "12.6" };
    expect(addressedByChange([resolved], values({ BASE_MATERIALS: 9.0 }))).toHaveLength(0);
  });

  it("an ADDRESSED Ask re-addresses on a further change", () => {
    const addressed = { ...base, status: "ADDRESSED" as const, valueAfter: "12.6" };
    const out = addressedByChange([addressed], values({ BASE_MATERIALS: 11.2 }));
    expect(out[0].valueAfter).toBe("11.2");
    // valueBefore is captured ONCE, so the pair still reads "when we asked" ->
    // "now". Overwriting it would lose the original.
    expect(out[0].valueBefore).toBe("13.8");
  });

  it("a REOPENED Ask can be addressed again", () => {
    const reopened = { ...base, status: "REOPENED" as const };
    expect(addressedByChange([reopened], values({ BASE_MATERIALS: 12 }))).toHaveLength(1);
  });

  it("an Ask with no reference value does not claim a response", () => {
    // Raised against a bucket the vendor had not filled: there is nothing to
    // have moved away from.
    const noRef = { ...base, valueBefore: null, valueAfter: null };
    expect(addressedByChange([noRef], values({ BASE_MATERIALS: 12 }))).toHaveLength(0);
  });

  it("handles a mix, touching only what changed", () => {
    const other: Ask = {
      ...base,
      id: "a2",
      bucket: "CRAFTING",
      valueBefore: "4.2",
    };
    const out = addressedByChange(
      [base, other],
      values({ BASE_MATERIALS: 12.6, CRAFTING: 4.2 }),
    );
    expect(out.map((o) => o.id)).toEqual(["a1"]);
  });
});

describe("targetLabel", () => {
  it("renders a range", () => {
    expect(targetLabel({ type: "REDUCE", targetPctLo: 8, targetPctHi: 12 })).toBe(
      "reduce by 8%–12%",
    );
  });

  it("collapses an equal range to one figure", () => {
    expect(targetLabel({ type: "REDUCE", targetPctLo: 10, targetPctHi: 10 })).toBe(
      "reduce by 10%",
    );
  });

  it("renders an open-ended target", () => {
    expect(targetLabel({ type: "REDUCE", targetPctLo: 5, targetPctHi: null })).toBe(
      "reduce by at least 5%",
    );
  });

  it("a CLARIFY Ask has no target", () => {
    expect(targetLabel({ type: "CLARIFY", targetPctLo: 8, targetPctHi: 12 })).toBeNull();
  });
});

describe("askSummary", () => {
  it("counts what still needs attention", () => {
    const s = askSummary([
      { status: "OPEN" },
      { status: "ADDRESSED" },
      { status: "RESOLVED" },
      { status: "REOPENED" },
    ]);
    expect(s).toEqual({ open: 2, addressed: 1, resolved: 1, outstanding: 3 });
  });

  it("an addressed Ask is still outstanding — procurement has not accepted it", () => {
    expect(askSummary([{ status: "ADDRESSED" }]).outstanding).toBe(1);
  });
});
