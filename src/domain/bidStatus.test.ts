import { describe, expect, it } from "vitest";
import {
  awaitingQuince,
  canVendorWithdraw,
  submitAdvancesTo,
  detailFor,
  hintFor,
  turnLabel,
  actionLabel,
  noteRequired,
  resumeTarget,
  stageOf,
  turnOf,
  vendorStatus,
  vendorStripLabel,
  VENDOR_EXIT,
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
    // ux/15: a revision on a FINAL bid stays at Final bid.
    expect(canTransition("FINAL_IN_REVIEW", "FINAL_REQUESTED", "QUINCE")).toBe(true);
    expect(canTransition("FINAL_IN_REVIEW", "IN_NEGOTIATION", "QUINCE")).toBe(false);
  });

  it("lets Quince drop a vendor from EVERY live state", () => {
    for (const s of BID_STATUSES) {
      if (s === "NOT_PROCEEDING" || s === "BID_ACCEPTED") continue;
      expect(canTransition(s, "NOT_PROCEEDING", "QUINCE")).toBe(true);
    }
  });

  it("lets Quince only REOPEN a declined bid, and nothing moves an accepted one", () => {
    // ux/15 (Akshay, 9 Oct): a Decline can be reversed by Quince.
    expect(transitionsFrom("NOT_PROCEEDING")).toEqual([{ to: "INVITED", by: "QUINCE" }]);
    expect(transitionsFrom("NOT_PROCEEDING", "VENDOR")).toEqual([]);
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

  it("lets them REINSTATE — and only Quince can reopen a Decline", () => {
    expect(canTransition("WITHDRAWN", "INVITED", "VENDOR")).toBe(true);
    expect(canTransition("NOT_PROCEEDING", "INVITED", "VENDOR")).toBe(false);
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
    expect(dead).toEqual(["BID_ACCEPTED"]);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   J5 / J6 — the three facts, separated.
   ──────────────────────────────────────────────────────────────────────────── */

describe("whose turn it is", () => {
  it("never disagrees with awaitingQuince", () => {
    // The two are derived from one cue, and this is the test that keeps them
    // that way: a future status whose marker says "Your turn" while the
    // product list says it is waiting on Quince would be the two-sources-of-
    // truth bug the whole single-stored-value design exists to prevent.
    for (const s of BID_STATUSES) {
      expect(turnOf(s) === "QUINCE").toBe(awaitingQuince(s));
    }
  });

  it("puts every acting state on the vendor and every done state on neither", () => {
    expect(BID_STATUSES.filter((s) => turnOf(s) === "VENDOR")).toEqual([
      "INVITED",
      "CHANGES_REQUESTED",
      "INITIAL_CLEARED",
      "IN_NEGOTIATION",
      "FINAL_REQUESTED",
      "WITHDRAWN",
    ]);
    expect(BID_STATUSES.filter((s) => turnOf(s) === "DONE")).toEqual([
      "BID_ACCEPTED",
      "NOT_PROCEEDING",
    ]);
  });

  it("reads 'Your turn' / 'With Quince' / 'Done' and nothing else", () => {
    const seen = new Set(BID_STATUSES.map(turnLabel));
    expect([...seen].sort()).toEqual(["Done", "With Quince", "Your turn"]);
  });
});

describe("the short status is a name, not a sentence", () => {
  it("never contains the em-dash phrasing the label set uses", () => {
    // "Full costing submitted — with Quince" is what this replaces.
    for (const s of BID_STATUSES) {
      expect(vendorStatus(s)).not.toContain("—");
      expect(vendorStatus(s).toLowerCase()).not.toContain("with quince");
    }
  });

  it("stays short enough to sit in a badge", () => {
    for (const s of BID_STATUSES) {
      expect(vendorStatus(s).length).toBeLessThanOrEqual(18);
    }
  });

  /**
   * SUPERSEDED BY J8. This used to assert that the needed and review stages
   * shared a name ("Full costing" for both), with the marker carrying the
   * difference. Akshay: "The status should be 'Under Review', not
   * 'Reviewed'" — a stage Quince is still looking at must say so, because
   * the vendor reads the status first and the marker second.
   */
  it("says 'Under review' for every stage Quince is holding", () => {
    for (const s of BID_STATUSES.filter(awaitingQuince)) {
      expect(vendorStatus(s)).toBe("Under review");
    }
  });

  it("NEVER claims a stage is reviewed while it is being reviewed", () => {
    // The defect this replaces: the strip read "Reviewed" for a stage that
    // had not been. Nothing awaiting Quince may use that word.
    for (const s of BID_STATUSES) {
      if (awaitingQuince(s)) {
        expect(vendorStatus(s).toLowerCase()).not.toContain("reviewed");
      }
    }
  });

  it("keeps the strip and the badge agreeing on a stage's name", () => {
    for (const s of BID_STATUSES) {
      expect(vendorStripLabel(s)).toBe(vendorStatus(s));
    }
  });
});

describe("every status explains itself", () => {
  it("has a hint and a detail, and the detail says more than the hint", () => {
    for (const s of BID_STATUSES) {
      expect(hintFor(s).length).toBeGreaterThan(0);
      expect(detailFor(s).length).toBeGreaterThan(hintFor(s).length);
    }
  });

  it("never tells a waiting vendor to do something", () => {
    // A row that needs nothing from the vendor must not read as a task.
    for (const s of BID_STATUSES.filter(awaitingQuince)) {
      expect(hintFor(s)).toMatch(/Nothing needed/i);
    }
  });
});

describe("the vendor's one exit", () => {
  it("is withdraw, and is never not-proceeding", () => {
    expect(VENDOR_EXIT).toBe("WITHDRAWN");
    // Akshay, 5 Oct: the vendor withdraws, QUINCE does not proceed. A vendor
    // must never be offered the other side's word for ending a bid.
    for (const s of BID_STATUSES) {
      const theirs = transitionsFrom(s, "VENDOR").map((t) => t.to);
      expect(theirs).not.toContain("NOT_PROCEEDING");
    }
  });

  it("is available from every live stage and reversible", () => {
    const live = BID_STATUSES.filter(
      (s) => s !== "BID_ACCEPTED" && s !== "NOT_PROCEEDING" && s !== "WITHDRAWN",
    );
    for (const s of live) expect(canVendorWithdraw(s)).toBe(true);
    // Reinstating is what makes withdrawal safe to offer at all.
    expect(transitionsFrom("WITHDRAWN", "VENDOR").length).toBeGreaterThan(0);
  });
});

describe("submitting advances the ladder", () => {
  it("moves every acting stage to its review stage", () => {
    expect(submitAdvancesTo("INVITED")).toBe("INITIAL_IN_REVIEW");
    expect(submitAdvancesTo("CHANGES_REQUESTED")).toBe("INITIAL_IN_REVIEW");
    expect(submitAdvancesTo("INITIAL_CLEARED")).toBe("FULL_IN_REVIEW");
    expect(submitAdvancesTo("IN_NEGOTIATION")).toBe("FULL_IN_REVIEW");
    expect(submitAdvancesTo("FINAL_REQUESTED")).toBe("FINAL_IN_REVIEW");
  });

  it("does nothing where submitting has no meaning", () => {
    // Already with Quince, decided, or withdrawn.
    for (const s of ["INITIAL_IN_REVIEW", "FULL_IN_REVIEW", "FINAL_IN_REVIEW",
                     "BID_ACCEPTED", "NOT_PROCEEDING", "WITHDRAWN"] as BidStatus[]) {
      expect(submitAdvancesTo(s)).toBeNull();
    }
  });

  it("always lands on a stage that is waiting on Quince", () => {
    // The invariant that matters: after submitting, the vendor must never
    // still read "Your turn".
    for (const s of BID_STATUSES) {
      const next = submitAdvancesTo(s);
      if (next) expect(turnOf(next)).toBe("QUINCE");
    }
  });
});

describe("ux/15 — stages, action names and resume targets", () => {
  it("names actions, not destinations", () => {
    expect(actionLabel("INITIAL_IN_REVIEW", "INITIAL_CLEARED")).toBe("Advance to full costing");
    expect(actionLabel("FULL_IN_REVIEW", "IN_NEGOTIATION")).toBe("Request revision");
    expect(actionLabel("FINAL_IN_REVIEW", "FINAL_REQUESTED")).toBe("Request revision");
    expect(actionLabel("FULL_IN_REVIEW", "FINAL_REQUESTED")).toBe("Request final bid");
    expect(actionLabel("FULL_IN_REVIEW", "NOT_PROCEEDING")).toBe("Decline");
    expect(actionLabel("NOT_PROCEEDING", "INVITED")).toBe("Reopen");
  });
  it("puts every status in exactly one stage", () => {
    expect(stageOf("CHANGES_REQUESTED")).toBe("Initial quote");
    expect(stageOf("IN_NEGOTIATION")).toBe("Full costing");
    expect(stageOf("FINAL_IN_REVIEW")).toBe("Final bid");
  });
  it("reinstates to the exact status left, and reopens with the vendor to act", () => {
    expect(resumeTarget("WITHDRAWN", "FULL_IN_REVIEW")).toBe("FULL_IN_REVIEW");
    expect(resumeTarget("NOT_PROCEEDING", "FULL_IN_REVIEW")).toBe("IN_NEGOTIATION");
    expect(resumeTarget("NOT_PROCEEDING", "INITIAL_CLEARED")).toBe("INITIAL_CLEARED");
    expect(resumeTarget("NOT_PROCEEDING", null)).toBe("INVITED");
  });
  it("requires feedback on a revision or a decline, not on advancing", () => {
    expect(noteRequired("FULL_IN_REVIEW", "IN_NEGOTIATION")).toBe(true);
    expect(noteRequired("FULL_IN_REVIEW", "NOT_PROCEEDING")).toBe(true);
    expect(noteRequired("INITIAL_IN_REVIEW", "INITIAL_CLEARED")).toBe(false);
  });
});
