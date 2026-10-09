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
    quince: "Initial quote · With vendor",
    vendor: "Quote needed",
    cue: "act",
    template: "LIGHT",
    onStrip: true,
  },
  INITIAL_IN_REVIEW: {
    quince: "Initial quote · With Quince",
    vendor: "Initial quote submitted — with Quince",
    cue: "wait",
    template: "LIGHT",
    onStrip: true,
  },
  CHANGES_REQUESTED: {
    quince: "Initial quote · Revision requested",
    vendor: "Initial quote · Revision requested",
    cue: "act",
    template: "LIGHT",
    onStrip: false,
  },
  INITIAL_CLEARED: {
    quince: "Full costing · With vendor",
    vendor: "Full costing needed",
    cue: "act",
    template: "FULL",
    onStrip: true,
  },
  FULL_IN_REVIEW: {
    quince: "Full costing · With Quince",
    vendor: "Full costing submitted — with Quince",
    cue: "wait",
    template: "FULL",
    onStrip: true,
  },
  IN_NEGOTIATION: {
    quince: "Full costing · Revision requested",
    vendor: "Full costing · Revision requested",
    cue: "act",
    template: "FULL",
    // OFF the strip. Negotiation is a LOOP, not a forward step — it can
    // repeat any number of times, which is exactly what replaced rounds.
    // Drawing it as a station would imply the process moves backwards.
    onStrip: false,
  },
  FINAL_REQUESTED: {
    quince: "Final bid · With vendor",
    vendor: "Final bid needed — all variants",
    cue: "act",
    template: "FULL",
    onStrip: true,
  },
  FINAL_IN_REVIEW: {
    quince: "Final bid · With Quince",
    vendor: "Final bid submitted — with Quince",
    cue: "wait",
    template: "FULL",
    onStrip: true,
  },
  BID_ACCEPTED: {
    quince: "Accepted",
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
    quince: "Declined",
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
  // A revision on a FINAL bid stays at Final bid (ux/15) — it used to drop
  // back to Full costing review.
  FINAL_IN_REVIEW: [
    { to: "FINAL_REQUESTED", by: "QUINCE" },
    { to: "BID_ACCEPTED", by: "QUINCE" },
    { to: "WITHDRAWN", by: "VENDOR" },
  ],
  // Accepted is where negotiation stops. The award decision follows, and
  // does NOT currently require acceptance (H7) — noted as a known gap.
  BID_ACCEPTED: [],
  // Reinstatement returns the vendor to the start of the ladder: their old
  // quote survives, so they resume rather than restart.
  // INVITED here is the "resume" move: the route sends the bid back to where
  // it was (resumeTarget), not to the start (ux/15).
  WITHDRAWN: [{ to: "INVITED", by: "VENDOR" }],
  NOT_PROCEEDING: [{ to: "INVITED", by: "QUINCE" }],
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

/* ─────────────────────────────────────────────────────────────────────────────
   WHOSE TURN, AND WHAT TO DO — decisions J5/J6, 4 Oct.

   `vendorLabel()` was carrying THREE facts in one string: the stage, whose
   turn it is, and implicitly what to do. Akshay, 4 Oct: "it is not clear
   whether the action is on the vendor or with Quince", and "'full costing
   submitted with Quince' doesn't seem like a status. It seems like text."

   He is right — "Full costing submitted — with Quince" is a sentence in a
   Badge. So the three facts become three functions, and the UI gives each
   its own slot. `vendorLabel()` is KEPT: the vendor's product LIST is
   scannable precisely because its one column says both things at once.
   ──────────────────────────────────────────────────────────────────────────── */

/** Whose move it is. Derived from the cue, so it can never disagree with it. */
export type Turn = "VENDOR" | "QUINCE" | "DONE";

export function turnOf(status: BidStatus): Turn {
  const cue = cueOf(status);
  if (cue === "wait") return "QUINCE";
  if (cue === "done") return "DONE";
  return "VENDOR";
}

/** The marker beside the status. The only emphasis on a row that needs one. */
export function turnLabel(status: BidStatus): string {
  switch (turnOf(status)) {
    case "VENDOR":
      return "Your turn";
    case "QUINCE":
      return "With Quince";
    case "DONE":
      return "Done";
  }
}

/**
 * The SHORT status name — a name, not a sentence.
 *
 * Three stages share a name across the submitted/cleared pair ("Full
 * costing" is both "needed" and "in review") because the marker now carries
 * that difference. That is the point: the stage is WHERE the bid is, the
 * marker is WHO holds it.
 */
const VENDOR_STATUS: Record<BidStatus, string> = {
  INVITED: "Initial quote",
  // "UNDER REVIEW" WHILE QUINCE HOLDS IT — decision J8, 5 Oct.
  //
  // Akshay: "The status should be 'Under Review', not 'Reviewed'. Only when
  // it is reviewed should it show 'Reviewed'." The previous naming called a
  // stage "Reviewed" while Quince was still looking at it, which claimed
  // something untrue. A stage is only reviewed once it has been.
  INITIAL_IN_REVIEW: "Under review",
  CHANGES_REQUESTED: "Revision requested",
  INITIAL_CLEARED: "Full costing",
  FULL_IN_REVIEW: "Under review",
  IN_NEGOTIATION: "Revision requested",
  FINAL_REQUESTED: "Final bid",
  FINAL_IN_REVIEW: "Under review",
  BID_ACCEPTED: "Accepted",
  NOT_PROCEEDING: "Not proceeding",
  WITHDRAWN: "Withdrawn",
};

/**
 * The vendor's STRIP label — the stage as a step in a sequence.
 *
 * Mostly the same as the status, which is the point: the strip and the badge
 * should not disagree about what a stage is called. "Under review" appearing
 * three times is correct — they are genuinely the same kind of step at
 * different depths, and the marker plus the position say which one you are
 * at. That is different from the old defect, where one word claimed a review
 * had happened when it had not.
 */
export function vendorStripLabel(status: BidStatus): string {
  return VENDOR_STATUS[status];
}

export function vendorStatus(status: BidStatus): string {
  return VENDOR_STATUS[status];
}

/**
 * The always-visible one-liner under the status (J6).
 *
 * Permanent rather than hover-only: a vendor should not have to discover
 * what is wanted. The tooltip carries the longer explanation; this carries
 * the instruction.
 */
const VENDOR_HINT: Record<BidStatus, string> = {
  INVITED: "Send bucket totals for each variation you can make.",
  INITIAL_IN_REVIEW:
    "Quince is reviewing your initial quote. Nothing needed from you.",
  CHANGES_REQUESTED:
    "Quince requested a revision — see their feedback in Comments.",
  INITIAL_CLEARED: "Send the full cost breakdown for each variation.",
  FULL_IN_REVIEW:
    "Quince is reviewing your full costing. Nothing needed from you.",
  IN_NEGOTIATION:
    "Quince requested a revision — see their feedback in Comments.",
  FINAL_REQUESTED: "Final bid needed, on every variation.",
  FINAL_IN_REVIEW:
    "Quince is reviewing your final bid. Nothing needed from you.",
  BID_ACCEPTED: "Quince has accepted this bid.",
  NOT_PROCEEDING: "Quince is not proceeding on this product. Their feedback is in Comments.",
  WITHDRAWN: "You withdrew from this product. You can reinstate at any time.",
};

export function hintFor(status: BidStatus): string {
  return VENDOR_HINT[status];
}

/** The ⓘ detail — what this stage is, and what happens after it. */
const VENDOR_DETAIL: Record<BidStatus, string> = {
  INVITED:
    "Quince has asked you to quote this product. Give a total for each of the five cost buckets per variation; the line items behind them are optional at this stage. Quince reviews and either asks for changes or clears you to send a full costing.",
  INITIAL_IN_REVIEW:
    "Quince is reviewing your initial quote against their own cost model. They will either ask for changes or clear you to send the full costing.",
  CHANGES_REQUESTED:
    "Quince wants something changed before this goes further. The conversation says what. Update your quote and resubmit.",
  INITIAL_CLEARED:
    "Your initial quote cleared review. Now send the full breakdown — the line items behind each bucket — for every variation. Quince reviews, may ask you to revise, and then accepts or does not proceed.",
  FULL_IN_REVIEW:
    "Quince is reviewing your full costing. They may come back asking you to revise a bucket before accepting.",
  IN_NEGOTIATION:
    "Quince has asked you to revise this bid. The conversation says which buckets and why. This can happen more than once.",
  FINAL_REQUESTED:
    "Quince wants a final bid on every variation of this product. This is the last price before they decide.",
  FINAL_IN_REVIEW:
    "Quince is reviewing your final bid and deciding whether to accept it.",
  BID_ACCEPTED:
    "Quince has accepted this bid. Award volumes follow separately.",
  NOT_PROCEEDING:
    "Quince is not proceeding with you on this product. The bid is kept for the record.",
  WITHDRAWN:
    "You withdrew from this product, and Quince can see the reason you gave. You can reinstate at any time if the position changes.",
};

export function detailFor(status: BidStatus): string {
  return VENDOR_DETAIL[status];
}

/**
 * THE VENDOR'S ONE EXIT.
 *
 * Akshay, 5 Oct: "The vendor has only one option, which can be Withdraw,
 * and Quince have an option that they don't want to proceed."
 *
 * So the two exits are named for who owns them: a vendor WITHDRAWS, Quince
 * does NOT PROCEED. Withdrawal is reversible; not-proceeding is Quince's
 * call and is not offered to the vendor at all.
 */
export const VENDOR_EXIT: BidStatus = "WITHDRAWN";

export function canVendorWithdraw(status: BidStatus): boolean {
  return canTransition(status, VENDOR_EXIT, "VENDOR");
}

/**
 * WHERE SUBMITTING TAKES THE BID.
 *
 * Submitting a quote IS the vendor's forward move, so the ladder has to
 * follow it. Without this, five SUBMITTED quotes sat under a bid still
 * reading `CHANGES_REQUESTED` — the vendor's screen said "Your turn" after
 * they had finished, and Quince was never told the work had come back.
 *
 * Every acting stage has exactly ONE forward move (withdrawal aside), which
 * is what makes this derivable rather than a second hand-written map that
 * could drift from MOVES. Returns null where submitting means nothing —
 * a bid already with Quince, accepted, dropped, or withdrawn.
 */
export function submitAdvancesTo(status: BidStatus): BidStatus | null {
  if (status === "WITHDRAWN") return null;
  const forward = transitionsFrom(status, "VENDOR")
    .map((t) => t.to)
    .filter((to) => to !== VENDOR_EXIT);
  return forward.length === 1 ? forward[0]! : null;
}


/* ══ ux/15 — stages, turns and the names of Quince's actions ═══════════════ */

export type Stage = "Initial quote" | "Full costing" | "Final bid" | "Accepted" | "Declined" | "Withdrawn";

/** The STAGE a status belongs to — where the bid is, regardless of whose turn. */
export function stageOf(status: BidStatus): Stage {
  switch (status) {
    case "INVITED":
    case "INITIAL_IN_REVIEW":
    case "CHANGES_REQUESTED":
      return "Initial quote";
    case "INITIAL_CLEARED":
    case "FULL_IN_REVIEW":
    case "IN_NEGOTIATION":
      return "Full costing";
    case "FINAL_REQUESTED":
    case "FINAL_IN_REVIEW":
      return "Final bid";
    case "BID_ACCEPTED":
      return "Accepted";
    case "NOT_PROCEEDING":
      return "Declined";
    case "WITHDRAWN":
      return "Withdrawn";
  }
}

/**
 * What a move is CALLED — the action, not the destination. Quince reads
 * "Advance to full costing", "Request revision", "Decline"; the vendor reads
 * "Withdraw" / "Reinstate".
 */
export function actionLabel(from: BidStatus, to: BidStatus): string {
  if (to === "NOT_PROCEEDING") return "Decline";
  if (to === "WITHDRAWN") return "Withdraw";
  if (from === "NOT_PROCEEDING") return "Reopen";
  if (from === "WITHDRAWN") return "Reinstate";
  if (to === "BID_ACCEPTED") return "Accept bid";
  if (to === "INITIAL_CLEARED") return "Advance to full costing";
  if (to === "CHANGES_REQUESTED" || to === "IN_NEGOTIATION") return "Request revision";
  if (to === "FINAL_REQUESTED") return from === "FINAL_IN_REVIEW" ? "Request revision" : "Request final bid";
  return quinceLabel(to);
}

/** A Decline or a revision needs feedback; advancing or accepting may carry it. */
export function noteRequired(from: BidStatus, to: BidStatus): boolean {
  if (to === "NOT_PROCEEDING" || to === "CHANGES_REQUESTED" || to === "IN_NEGOTIATION") return true;
  if (from === "FINAL_IN_REVIEW" && to === "FINAL_REQUESTED") return true;
  if (from === "NOT_PROCEEDING") return true;
  return false;
}

/**
 * Where Reopen (Quince, from Declined) and Reinstate (vendor, from Withdrawn)
 * land. Reinstate returns to the EXACT status the vendor left. Reopen returns
 * to the stage it was declined at, with the vendor to act.
 */
export function resumeTarget(exit: BidStatus, before: BidStatus | null): BidStatus {
  if (!before || before === "NOT_PROCEEDING" || before === "WITHDRAWN") return "INVITED";
  if (exit === "WITHDRAWN") return before;
  const vendorTurn: Partial<Record<BidStatus, BidStatus>> = {
    INITIAL_IN_REVIEW: "CHANGES_REQUESTED",
    FULL_IN_REVIEW: "IN_NEGOTIATION",
    FINAL_IN_REVIEW: "FINAL_REQUESTED",
    BID_ACCEPTED: "FINAL_REQUESTED",
  };
  return vendorTurn[before] ?? before;
}
