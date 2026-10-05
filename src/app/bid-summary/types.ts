/** The shape of GET /api/bid-summary — one place, so the grid and drawer agree. */

export type Basis = "QUINCE_BLEND" | "DDP_BLEND";

export type BidRow = {
  invitationId: string;
  quoteId: string | null;
  rfp: { id: string; name: string; status: string; gm: string | null; sourcingPartner: string | null };
  vendor: {
    id: string;
    name: string;
    vendorCode: string;
    countryIso: string | null;
    cooRegion: string | null;
    isNewToQuince: boolean;
    type: "INCUMBENT" | "EXISTING" | "NEW";
  };
  hasBid: boolean;
  notIssued: boolean;
  cannotBid: boolean;
  stage: {
    status: string;
    quinceLabel: string;
    vendorLabel: string;
    turn: "VENDOR" | "QUINCE" | "DONE";
    awaitingReview: boolean;
  };
  price: {
    fob: number | null;
    quincePaid: { ocean: number; air: number; blend: number };
    ddp: { ocean: number | null; air: number | null; blend: number } | null;
    basis: Basis;
    automaticBasis: Basis;
    overridden: boolean;
    bestCost: number;
    deltaPct: number | null;
    annualSavings: number;
  } | null;
  terms: { leadTimeDays: number | null; capacity: number | null; moq: number | null } | null;
  award: { pct: number; dollars: number } | null;
};

export type BidGroup = {
  key: string;
  styleId: string;
  styleNumber: string;
  name: string;
  heroImage: string | null;
  division: string | null;
  department: string | null;
  subDepartment: string | null;
  material: string | null;
  colours: string[];
  variationId: string | null;
  variationLabel: string;
  planUnits: number;
  currentLanded: number;
  split: { airPct: number; set: boolean };
  allocatedPct: number;
  allocated: boolean;
  lowestBestCost: number | null;
  rows: BidRow[];
};

export type BidSummary = {
  groups: BidGroup[];
  counts: {
    all: number;
    awaitingReview: number;
    notBid: number;
    unallocatedVariants: number;
    variants: number;
  };
};

/** A row with the group it belongs to — what filters and the drawer work on. */
export type FlatRow = BidRow & { group: BidGroup; rowKey: string };
