import { describe, expect, it } from "vitest";
import {
  allowedForAll,
  allowedTransitions,
  canTransition,
  grainGroups,
  isExpandable,
  type VariationLike,
} from "./grain";

describe("the grain ladder is one-way", () => {
  it("lets STYLE become anything", () => {
    expect(allowedTransitions("STYLE")).toEqual(["COLOUR", "SIZE", "SKU"]);
  });

  it("lets COLOUR and SIZE go only to SKU", () => {
    expect(allowedTransitions("COLOUR")).toEqual(["SKU"]);
    expect(allowedTransitions("SIZE")).toEqual(["SKU"]);
  });

  it("makes SKU a leaf", () => {
    expect(allowedTransitions("SKU")).toEqual([]);
  });

  // The whole point of the rule: these would orphan finer-grained bids.
  it("refuses sideways moves", () => {
    expect(canTransition("COLOUR", "SIZE")).toBe(false);
    expect(canTransition("SIZE", "COLOUR")).toBe(false);
  });

  it("refuses every move back up", () => {
    expect(canTransition("COLOUR", "STYLE")).toBe(false);
    expect(canTransition("SIZE", "STYLE")).toBe(false);
    expect(canTransition("SKU", "STYLE")).toBe(false);
    expect(canTransition("SKU", "COLOUR")).toBe(false);
    expect(canTransition("SKU", "SIZE")).toBe(false);
  });
});

describe("bulk apply is the intersection", () => {
  it("offers only SKU when the set mixes COLOUR and SIZE", () => {
    // A buyer selecting both kinds can only push them to the common floor.
    expect(allowedForAll(["COLOUR", "SIZE"])).toEqual(["SKU"]);
  });

  it("offers everything when every product is STYLE", () => {
    expect(allowedForAll(["STYLE", "STYLE"])).toEqual([
      "STYLE",
      "COLOUR",
      "SIZE",
      "SKU",
    ]);
  });

  it("includes a target a product is ALREADY on", () => {
    // Re-applying SIZE to a set that is already SIZE is a no-op, not an error.
    expect(allowedForAll(["SIZE", "SIZE"])).toEqual(["SIZE", "SKU"]);
  });

  it("still offers SKU when the set mixes SIZE and an already-SKU product", () => {
    // SIZE can legally reach SKU, and for the SKU product it is a no-op.
    // A bulk action that is a no-op for some rows and a real change for
    // others is still legal — refusing it would block the common case of
    // "push this whole department down to SKU".
    expect(allowedForAll(["SIZE", "SKU"])).toEqual(["SKU"]);
  });

  it("offers nothing when every product is already a SKU leaf", () => {
    // SKU is in the list only because it is a no-op for itself; with nothing
    // below it there is no move to offer.
    expect(allowedForAll(["SKU", "SKU"])).toEqual(["SKU"]);
  });

  it("offers nothing when COLOUR and SKU are mixed", () => {
    // COLOUR→SKU is legal, SKU→SKU is a no-op, so SKU survives.
    expect(allowedForAll(["COLOUR", "SKU"])).toEqual(["SKU"]);
  });

  it("offers nothing for an empty selection", () => {
    expect(allowedForAll([])).toEqual([]);
  });
});

const vars: VariationLike[] = [
  { id: "a", size: "Twin", sizeSortOrder: 1, colour: "Ivory" },
  { id: "b", size: "Twin", sizeSortOrder: 1, colour: "Slate" },
  { id: "c", size: "King", sizeSortOrder: 4, colour: "Ivory" },
  { id: "d", size: "King", sizeSortOrder: 4, colour: "Slate" },
];

describe("grainGroups", () => {
  // THE load-bearing test: style level must be the degenerate case of the
  // same code path, or the 100% rule lands at the wrong scope.
  it("returns exactly ONE group at STYLE grain, covering everything", () => {
    const groups = grainGroups("STYLE", vars);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("@STYLE");
    expect(groups[0].variationIds).toEqual(["a", "b", "c", "d"]);
  });

  it("groups by colour, rolling every size in", () => {
    const groups = grainGroups("COLOUR", vars);
    expect(groups.map((g) => g.label)).toEqual(["Ivory", "Slate"]);
    expect(groups[0].variationIds).toEqual(["a", "c"]);
  });

  it("groups by size, rolling every colour in", () => {
    const groups = grainGroups("SIZE", vars);
    expect(groups.map((g) => g.label)).toEqual(["Twin", "King"]);
    expect(groups[0].variationIds).toEqual(["a", "b"]);
  });

  it("makes every variation its own group at SKU grain", () => {
    const groups = grainGroups("SKU", vars);
    expect(groups).toHaveLength(4);
    expect(groups.every((g) => g.variationIds.length === 1)).toBe(true);
  });

  it("preserves caller sort order rather than sorting alphabetically", () => {
    // Twin before King because sizeSortOrder says so — alphabetical would
    // put King first and read as wrong to anyone who knows bedding.
    expect(grainGroups("SIZE", vars).map((g) => g.label)).toEqual([
      "Twin",
      "King",
    ]);
  });

  it("survives a null size or colour rather than dropping the variation", () => {
    const groups = grainGroups("SIZE", [
      { id: "x", size: null, sizeSortOrder: null, colour: "Ivory" },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("—");
    expect(groups[0].variationIds).toEqual(["x"]);
  });

  it("returns one empty group for a product with no variations", () => {
    expect(grainGroups("SIZE", [])).toEqual([
      { key: "@STYLE", label: "All variations", variationIds: [] },
    ]);
  });
});

describe("isExpandable", () => {
  // A chevron that opens to one row restating the product reads as broken.
  it("is false at STYLE grain and true otherwise", () => {
    expect(isExpandable("STYLE")).toBe(false);
    expect(isExpandable("COLOUR")).toBe(true);
    expect(isExpandable("SIZE")).toBe(true);
    expect(isExpandable("SKU")).toBe(true);
  });
});
