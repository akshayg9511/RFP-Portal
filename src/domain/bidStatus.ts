/**
 * THE BID STATUS LADDER — what replaced rounds.
 *
 * Pure functions, no framework imports.
 *
 * Akshay, 2 Oct: "I am thinking not to introduce a concept of rounds, but
 * rather we will have a template against a product." Negotiation repeats via
 * IN_NEGOTIATION instead of an incrementing round counter, so
 * `Invitation.currentRound` and the designed-but-unbuilt `InvitationRound`
 * are both retired.
 *
 * ONE stored value with TWO label sets. Quince and the vendor read different
 * words for the same state, so they can never disagree about where a bid is:
 * deriving both from one field is what guarantees that.
 */

export type BidStatus =
  | "INVITED"
  | "INITIAL_IN_REVIEW"
  | "CHANGES_REQUESTED"
  | "INITIAL_CLEARED"
  | "FULL_IN_REVIEW"
  | "IN_NEGOTIATION"
  | "FINAL_REQUESTED"
  | "FINAL_IN_REVIEW"
  | "BID_ACCEPTED"
  | "WITHDRAWN"
  | "NOT_PROCEEDING";

export const BID_STATUSES: BidStatus[] = [
  "INVITED",
  "INITIAL_IN_REVIEW",
  "CHANGES_REQUESTED",
  "INITIAL_CLEARED",
  "FULL_IN_REVIEW",
  "IN_NEGOTIATION",
  "FINAL_REQUESTED",
  "FINAL_IN_REVIEW",
  "BID_ACCEPTED",
  "WITHDRAWN",
  "NOT_PROCEEDING",
];

/** Whose move it is. The vendor's list is scannable for "what do I owe". */
export type Cue = "act" | "wait" | "done";

type Meta = {
  /** What the Quince buyer reads. */
  quince: string;
  /**
   * What the VENDOR reads.
   *
   * Every waiting label ends "— with Quince". Akshay: "'submitted' is
   * repeated, and it can get confusing… they have to understand also where
   * they have to act fast and where they are waiting." So three distinct
   * submitted states carry three distinct labels.
   */
  vendor: string;
  cue: Cue;
  /** Which template the vendor form renders. */
  template: "LIGHT" | "FULL" | "NONE";
  /** Does the lifecycle strip show this stage? WITHDRAWN is an aside. */
  onStrip: boolean;
};

const META: Record<BidStatus, Meta> = {
  INVITED: {
    quince: "Invited",
    vendor: "Quote needed",
    cue: "act",
    template: "LIGHT",
    onStrip: true,
  },
  INITIAL_IN_REVIEW: {
    quince: "Initial quote in review",
    vendor: "Initial quote submitted — with Quince",
    cue: "wait",
    template: "LIGHT",
    onStrip: true,
  },
  CHANGES_REQUESTED: {
    quince: "Changes requested",
    vendor: "Changes requested",
    cue: "act",
    template: "LIGHT",
    onStrip: false,
  },
  INITIAL_CLEARED: {
    quince: "Initial quote cleared",
    vendor: "Full costing needed",
    cue: "act",
    template: "FULL",
    onStrip: true,
  },
  FULL_IN_REVIEW: {
    quince: "Full costing in review",
    vendor: "Full costing submitted — with Quince",
    cue: "wait",
    template: "FULL",
    onStrip: true,
  },
  IN_NEGOTIATION: {
    quince: "In negotiation",
    vendor: "Revised quote requested",
    cue: "act",
    template: "FULL",
    // OFF the strip. Negotiation is a LOOP, not a forward step — it can
    // repeat any number of times, which is exactly what replaced rounds.
    // Drawing it as a station would imply the process moves backwards.
    onStrip: false,
  },
  FINAL_REQUESTED: {
    quince: "Final bid requested",
    vendor: "Final bid needed — all variants",
    cue: "act",
    template: "FULL",
    onStrip: true,
  },
  FINAL_IN_REVIEW: {
    quince: "Final bid in review",
    vendor: "Final bid submitted — with Quince",
    cue: "wait",
    template: "FULL",
    onStrip: true,
  },
  BID_ACCEPTED: {
    quince: "Bid accepted",
    vendor: "Bid accepted",
    cue: "done",
    template: "NONE",
    onStrip: true,
  },
  WITHDRAWN: {
    quince: "Withdrawn by vendor",
    vendor: "Withdrawn — you can reinstate",
    cue: "act",
    template: "NONE",
    onStrip: false,
  },
  NOT_PROCEEDING: {
    quince: "Not proceeding",
    vendor: "Not proceeding",
    cue: "done",
    template: "NONE",
    onStrip: false,
  },
};

export function quinceLabel(status: BidStatus): string {
  return META[status].quince;
}

export function vendorLabel(status: BidStatus): string {
  return META[status].vendor;
}

export function cueOf(status: BidStatus): Cue {
  return META[status].cue;
}

/** Which template the vendor form renders at this stage (H8). */
export function templateFor(status: BidStatus): "LIGHT" | "FULL" | "NONE" {
  return META[status].template;
}

/**
 * The stages shown on the vendor's lifecycle strip.
 *
 * CHANGES_REQUESTED, IN_NEGOTIATION and WITHDRAWN are deliberately off it:
 * they are loops and asides, not forward steps, and drawing them as stations
 * would imply the process goes backwards.
 */
export const STRIP: BidStatus[] = BID_STATUSES.filter((s) => META[s].onStrip);

/**
 * Where a status sits on the strip, for rendering progress. Returns the
 * index of the nearest strip stage at or before it, so a loop state still
 * shows the right position.
 */
export function stripPosition(status: BidStatus): number {
  if (META[status].onStrip) return STRIP.indexOf(status);
  // A loop reads as sitting at the stage it loops back from.
  if (status === "CHANGES_REQUESTED") return STRIP.indexOf("INVITED");
  if (status === "IN_NEGOTIATION") return STRIP.indexOf("FULL_IN_REVIEW");
  return -1;
}

/** Who may make a given move. */
export type Actor = "QUINCE" | "VENDOR";

/**
 * Legal transitions.
 *
 * NOT_PROCEEDING is reachable from ANY live state — Quince can drop a vendor
 * at any point. WITHDRAWN is the vendor's mirror of that and is REVERSIBLE,
 * which no other terminal state is: Akshay, 4 Oct — "yes can withdraw at any
 * time. But after withdrawing can reinstate as well."
 */
const MOVES: Record<BidStatus, { to: BidStatus; by: Actor }[]> = {
  INVITED: [
    { to: "INITIAL_IN_REVIEW", by: "VENDOR" },
    { to: "WITHDRAWN", by: "VENDOR" },
  ],
  INITIAL_IN_REVIEW: [
    { to: "CHANGES_REQUESTED", by: "QUINCE" },
    { to: "INITIAL_CLEARED", by: "QUINCE" },
    { to: "WITHDRAWN", by: "VENDOR" },
  ],
  CHANGES_REQUESTED: [
    { to: "INITIAL_IN_REVIEW", by: "VENDOR" },
    { to: "WITHDRAWN", by: "VENDOR" },
  ],
  INITIAL_CLEARED: [
    { to: "FULL_IN_REVIEW", by: "VENDOR" },
    { to: "WITHDRAWN", by: "VENDOR" },
  ],
  FULL_IN_REVIEW: [
    { to: "IN_NEGOTIATION", by: "QUINCE" },
    { to: "FINAL_REQUESTED", by: "QUINCE" },
    { to: "WITHDRAWN", by: "VENDOR" },
  ],
  // Repeatable: negotiation can bounce back and forth, which is what rounds
  // were for.
  IN_NEGOTIATION: [
    { to: "FULL_IN_REVIEW", by: "VENDOR" },
    { to: "FINAL_REQUESTED", by: "QUINCE" },
    { to: "WITHDRAWN", by: "VENDOR" },
  ],
  FINAL_REQUESTED: [
    { to: "FINAL_IN_REVIEW", by: "VENDOR" },
    { to: "WITHDRAWN", by: "VENDOR" },
  ],
  FINAL_IN_REVIEW: [
    { to: "IN_NEGOTIATION", by: "QUINCE" },
    { to: "BID_ACCEPTED", by: "QUINCE" },
    { to: "WITHDRAWN", by: "VENDOR" },
  ],
  // Accepted is where negotiation stops. The award decision follows, and
  // does NOT currently require acceptance (H7) — noted as a known gap.
  BID_ACCEPTED: [],
  // Reinstatement returns the vendor to the start of the ladder: their old
  // quote survives, so they resume rather than restart.
  WITHDRAWN: [{ to: "INVITED", by: "VENDOR" }],
  NOT_PROCEEDING: [],
};

/** Every live state can be dropped by Quince. */
const DROPPABLE: BidStatus[] = BID_STATUSES.filter(
  (s) => s !== "NOT_PROCEEDING" && s !== "BID_ACCEPTED",
);

export function transitionsFrom(
  status: BidStatus,
  by?: Actor,
): { to: BidStatus; by: Actor }[] {
  const base = [...MOVES[status]];
  if (DROPPABLE.includes(status)) {
    base.push({ to: "NOT_PROCEEDING", by: "QUINCE" });
  }
  return by ? base.filter((m) => m.by === by) : base;
}

export function canTransition(
  from: BidStatus,
  to: BidStatus,
  by: Actor,
): boolean {
  return transitionsFrom(from, by).some((m) => m.to === to);
}

/** Is the vendor allowed to edit their quote right now? */
export function vendorCanEdit(status: BidStatus): boolean {
  return cueOf(status) === "act" && status !== "WITHDRAWN";
}

/** Has the vendor submitted something Quince has not yet acted on? */
export function awaitingQuince(status: BidStatus): boolean {
  return cueOf(status) === "wait";
}
