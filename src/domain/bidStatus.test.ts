import { describe, expect, it } from "vitest";
import {
  awaitingQuince,
  BID_STATUSES,
  canTransition,
  cueOf,
  quinceLabel,
  STRIP,
  stripPosition,
  templateFor,
  transitionsFrom,
  vendorCanEdit,
  vendorLabel,
  type BidStatus,
} from "./bidStatus";

describe("the two label sets", () => {
  it("gives every status both a Quince and a vendor label", () => {
    for (const s of BID_STATUSES) {
      expect(quinceLabel(s).length).toBeGreaterThan(0);
      expect(vendorLabel(s).length).toBeGreaterThan(0);
    }
  });

  // THE point of two label sets: three states are "submitted" to Quince and
  // must read differently to the vendor, or they cannot tell which one they
  // are waiting on.
  it("gives the three review states DISTINCT vendor labels", () => {
    const labels = [
      vendorLabel("INITIAL_IN_REVIEW"),
      vendorLabel("FULL_IN_REVIEW"),
      vendorLabel("FINAL_IN_REVIEW"),
    ];
    expect(new Set(labels).size).toBe(3);
  });

  it("ends every waiting label with '— with Quince'", () => {
    for (const s of BID_STATUSES) {
      if (cueOf(s) === "wait") {
        expect(vendorLabel(s)).toMatch(/— with Quince$/);
      }
    }
  });

  it("never says 'with Quince' on a state the vendor must act on", () => {
    for (const s of BID_STATUSES) {
      if (cueOf(s) === "act") {
        expect(vendorLabel(s)).not.toContain("with Quince");
      }
    }
  });
});

describe("which template renders", () => {
  it("asks bucket totals until the initial quote clears", () => {
    expect(templateFor("INVITED")).toBe("LIGHT");
    expect(templateFor("INITIAL_IN_REVIEW")).toBe("LIGHT");
    expect(templateFor("CHANGES_REQUESTED")).toBe("LIGHT");
  });

  it("switches to the full template once cleared", () => {
    expect(templateFor("INITIAL_CLEARED")).toBe("FULL");
    expect(templateFor("IN_NEGOTIATION")).toBe("FULL");
    expect(templateFor("FINAL_REQUESTED")).toBe("FULL");
  });

  it("asks for nothing once the bid is closed", () => {
    expect(templateFor("BID_ACCEPTED")).toBe("NONE");
    expect(templateFor("NOT_PROCEEDING")).toBe("NONE");
  });
});

describe("legal transitions", () => {
  it("lets the VENDOR submit but not clear their own quote", () => {
    expect(canTransition("INVITED", "INITIAL_IN_REVIEW", "VENDOR")).toBe(true);
    expect(canTransition("INITIAL_IN_REVIEW", "INITIAL_CLEARED", "VENDOR")).toBe(
      false,
    );
  });

  it("lets QUINCE clear but not submit on the vendor's behalf", () => {
    expect(canTransition("INITIAL_IN_REVIEW", "INITIAL_CLEARED", "QUINCE")).toBe(
      true,
    );
    expect(canTransition("INVITED", "INITIAL_IN_REVIEW", "QUINCE")).toBe(false);
  });

  // Negotiation repeating is what replaced rounds.
  it("lets negotiation bounce back and forth without a counter", () => {
    expect(canTransition("FULL_IN_REVIEW", "IN_NEGOTIATION", "QUINCE")).toBe(true);
    expect(canTransition("IN_NEGOTIATION", "FULL_IN_REVIEW", "VENDOR")).toBe(true);
    expect(canTransition("FINAL_IN_REVIEW", "IN_NEGOTIATION", "QUINCE")).toBe(true);
  });

  it("lets Quince drop a vendor from EVERY live state", () => {
    for (const s of BID_STATUSES) {
      if (s === "NOT_PROCEEDING" || s === "BID_ACCEPTED") continue;
      expect(canTransition(s, "NOT_PROCEEDING", "QUINCE")).toBe(true);
    }
  });

  it("does not let a dropped or accepted bid move on", () => {
    expect(transitionsFrom("NOT_PROCEEDING")).toEqual([]);
    expect(transitionsFrom("BID_ACCEPTED")).toEqual([]);
  });

  it("refuses a move the actor does not own", () => {
    expect(canTransition("INVITED", "BID_ACCEPTED", "VENDOR")).toBe(false);
    expect(canTransition("INVITED", "FINAL_REQUESTED", "QUINCE")).toBe(false);
  });
});

describe("withdrawal is reversible — the only state that is", () => {
  it("lets the vendor withdraw from any live state", () => {
    for (const s of BID_STATUSES) {
      if (["WITHDRAWN", "NOT_PROCEEDING", "BID_ACCEPTED"].includes(s)) continue;
      expect(canTransition(s, "WITHDRAWN", "VENDOR")).toBe(true);
    }
  });

  it("lets them REINSTATE, unlike every other terminal state", () => {
    expect(canTransition("WITHDRAWN", "INVITED", "VENDOR")).toBe(true);
    // The contrast that makes withdrawal different from being dropped.
    expect(transitionsFrom("NOT_PROCEEDING")).toEqual([]);
  });

  it("is the vendor's move, never Quince's", () => {
    expect(canTransition("INVITED", "WITHDRAWN", "QUINCE")).toBe(false);
  });
});

describe("the lifecycle strip", () => {
  it("leaves loops and asides OFF it", () => {
    // Drawing a loop as a station would imply the process goes backwards.
    expect(STRIP).not.toContain("CHANGES_REQUESTED");
    expect(STRIP).not.toContain("IN_NEGOTIATION");
    expect(STRIP).not.toContain("WITHDRAWN");
    expect(STRIP).not.toContain("NOT_PROCEEDING");
  });

  it("runs from invited to accepted in order", () => {
    expect(STRIP[0]).toBe("INVITED");
    expect(STRIP[STRIP.length - 1]).toBe("BID_ACCEPTED");
  });

  it("places a loop state at the stage it loops back from", () => {
    expect(stripPosition("CHANGES_REQUESTED")).toBe(STRIP.indexOf("INVITED"));
    expect(stripPosition("IN_NEGOTIATION")).toBe(
      STRIP.indexOf("FULL_IN_REVIEW"),
    );
  });

  it("gives an on-strip status its own index", () => {
    expect(stripPosition("INITIAL_CLEARED")).toBe(
      STRIP.indexOf("INITIAL_CLEARED"),
    );
  });
});

describe("edit and wait helpers", () => {
  it("lets the vendor edit only when it is their move", () => {
    expect(vendorCanEdit("INVITED")).toBe(true);
    expect(vendorCanEdit("CHANGES_REQUESTED")).toBe(true);
    expect(vendorCanEdit("INITIAL_IN_REVIEW")).toBe(false);
    expect(vendorCanEdit("BID_ACCEPTED")).toBe(false);
  });

  // A withdrawn vendor must reinstate before editing, not edit to reinstate.
  it("does NOT let a withdrawn vendor edit", () => {
    expect(vendorCanEdit("WITHDRAWN")).toBe(false);
  });

  it("flags exactly the three review states as awaiting Quince", () => {
    const waiting = BID_STATUSES.filter(awaitingQuince);
    expect(waiting).toEqual([
      "INITIAL_IN_REVIEW",
      "FULL_IN_REVIEW",
      "FINAL_IN_REVIEW",
    ]);
  });
});

describe("no status is a dead end by accident", () => {
  it("leaves only the two deliberate terminal states without moves", () => {
    const dead = BID_STATUSES.filter(
      (s: BidStatus) => transitionsFrom(s).length === 0,
    );
    expect(dead).toEqual(["BID_ACCEPTED", "NOT_PROCEEDING"]);
  });
});
