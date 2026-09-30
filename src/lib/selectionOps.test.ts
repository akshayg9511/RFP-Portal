import { describe, expect, it } from "vitest";
import {
  addMany,
  isPartial,
  restore,
  selectAllVariations,
  skuCount,
  toggleStyle,
  toggleVariation,
  type SelectedStyle,
  type SelectionMap,
} from "./selectionOps";

const style = (id: string): SelectedStyle => ({
  id,
  styleNumber: id.toUpperCase(),
  name: `Product ${id}`,
  division: "Home",
  department: "Bedding",
  annualSpend: 1000,
});

const empty = (): SelectionMap => new Map();

describe("toggleStyle", () => {
  it("adds then removes", () => {
    const one = toggleStyle(empty(), style("a"));
    expect(one.has("a")).toBe(true);
    expect(toggleStyle(one, style("a")).has("a")).toBe(false);
  });
});

describe("addMany keeps TOGGLE semantics", () => {
  // Two screens use one button for "Select all / Deselect all" and depend on
  // this. A plain add would break both.
  it("deselects all when every one is already in", () => {
    const both = addMany(empty(), [style("a"), style("b")]);
    expect(both.size).toBe(2);
    expect(addMany(both, [style("a"), style("b")]).size).toBe(0);
  });

  it("selects all when only some are in", () => {
    const one = toggleStyle(empty(), style("a"));
    expect(addMany(one, [style("a"), style("b")]).size).toBe(2);
  });
});

describe("toggleVariation", () => {
  it("selects the PRODUCT when a variation is ticked on an unselected one", () => {
    // A child row is a way into the selection; it must not require the
    // parent to be ticked first.
    const next = toggleVariation(empty(), style("a"), "v1");
    expect(next.get("a")?.variationIds).toEqual(["v1"]);
  });

  it("accumulates variations", () => {
    let m = toggleVariation(empty(), style("a"), "v1");
    m = toggleVariation(m, style("a"), "v2");
    expect(m.get("a")?.variationIds).toEqual(["v1", "v2"]);
  });

  // THE rule that prevents a wrong RFP: an empty variation list means "the
  // whole product", so a product must never be left selected with none.
  it("REMOVES the product when the last variation is unticked", () => {
    let m = toggleVariation(empty(), style("a"), "v1");
    m = toggleVariation(m, style("a"), "v1");
    expect(m.has("a")).toBe(false);
  });

  it("leaves other products alone", () => {
    let m = toggleVariation(empty(), style("a"), "v1");
    m = toggleVariation(m, style("b"), "v9");
    expect(m.get("a")?.variationIds).toEqual(["v1"]);
    expect(m.get("b")?.variationIds).toEqual(["v9"]);
  });

  // REGRESSION: ticking variations one at a time left variationTotal at 0,
  // so isPartial() returned false and the parent checkbox showed a TICK for
  // "2 of 5 selected" instead of a dash. Caught in a browser, not by reading
  // the code — the row meta said "2 selected" while the box said "all".
  it("records the total when ticking ONE variation, so isPartial works", () => {
    const m = toggleVariation(empty(), style("a"), "v1", 5);
    expect(m.get("a")?.variationTotal).toBe(5);
    expect(isPartial(m, "a")).toBe(true);
  });

  it("keeps the total across further individual ticks", () => {
    let m = toggleVariation(empty(), style("a"), "v1", 5);
    m = toggleVariation(m, style("a"), "v2", 5);
    expect(isPartial(m, "a")).toBe(true);
    expect(m.get("a")?.variationIds).toEqual(["v1", "v2"]);
  });

  it("is NOT partial once every variation is ticked one by one", () => {
    let m = empty();
    for (const id of ["v1", "v2", "v3"]) {
      m = toggleVariation(m, style("a"), id, 3);
    }
    expect(isPartial(m, "a")).toBe(false);
  });

  it("preserves variationTotal set earlier", () => {
    const m = selectAllVariations(empty(), style("a"), ["v1", "v2", "v3"]);
    const after = toggleVariation(m, style("a"), "v3");
    expect(after.get("a")?.variationTotal).toBe(3);
    expect(after.get("a")?.variationIds).toEqual(["v1", "v2"]);
  });
});

describe("selectAllVariations", () => {
  it("ticks every variation and records the total", () => {
    const m = selectAllVariations(empty(), style("a"), ["v1", "v2"]);
    expect(m.get("a")?.variationIds).toEqual(["v1", "v2"]);
    expect(m.get("a")?.variationTotal).toBe(2);
  });

  it("toggles the product off when all are already in", () => {
    const m = selectAllVariations(empty(), style("a"), ["v1", "v2"]);
    expect(selectAllVariations(m, style("a"), ["v1", "v2"]).has("a")).toBe(false);
  });

  it("completes a partial selection rather than clearing it", () => {
    const partial = toggleVariation(empty(), style("a"), "v1");
    const all = selectAllVariations(partial, style("a"), ["v1", "v2"]);
    expect(all.get("a")?.variationIds).toEqual(["v1", "v2"]);
  });
});

describe("isPartial drives the mixed checkbox", () => {
  it("is false when nothing is selected", () => {
    expect(isPartial(empty(), "a")).toBe(false);
  });

  it("is true for some but not all", () => {
    const m = selectAllVariations(empty(), style("a"), ["v1", "v2", "v3"]);
    const after = toggleVariation(m, style("a"), "v3");
    expect(isPartial(after, "a")).toBe(true);
  });

  it("is false when all are selected", () => {
    const m = selectAllVariations(empty(), style("a"), ["v1", "v2"]);
    expect(isPartial(m, "a")).toBe(false);
  });

  it("is false for a whole-product selection with no variations", () => {
    // A style-grained product is fully selected, never partial.
    const m = toggleStyle(empty(), style("a"));
    expect(isPartial(m, "a")).toBe(false);
  });
});

describe("skuCount counts variations, not products", () => {
  it("is 0 for whole-product selections", () => {
    expect(skuCount(addMany(empty(), [style("a"), style("b")]))).toBe(0);
  });

  it("sums across products", () => {
    let m = selectAllVariations(empty(), style("a"), ["v1", "v2"]);
    m = toggleVariation(m, style("b"), "v9");
    expect(skuCount(m)).toBe(3);
  });
});

describe("restore survives a stale session", () => {
  it("returns empty for null or junk", () => {
    expect(restore(null).size).toBe(0);
    expect(restore("not json").size).toBe(0);
    expect(restore('{"not":"an array"}').size).toBe(0);
  });

  // The backward-compatibility case: a tab open from before this field
  // existed must not throw on first render.
  it("defaults variationIds on an entry stored before the field existed", () => {
    const legacy = JSON.stringify([["a", style("a")]]);
    expect(restore(legacy).get("a")?.variationIds).toEqual([]);
  });

  it("round-trips a variation selection", () => {
    const m = selectAllVariations(empty(), style("a"), ["v1", "v2"]);
    const back = restore(JSON.stringify([...m]));
    expect(back.get("a")?.variationIds).toEqual(["v1", "v2"]);
    expect(back.get("a")?.variationTotal).toBe(2);
  });
});
