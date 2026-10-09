/** The shape of GET /api/bid-summary — one place, so the grid and drawer agree. */

export type Basis = "QUINCE_BLEND" | "DDP_BLEND";

/** One cost in each freight mode. Blend uses the variant's air/ocean split. */
export type Modes = { ocean: number; air: number; blend: number };
export type CostMode = keyof Modes;

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
    /** Tariff at the vendor's COO, as a fraction, and in $ on this FOB. */
    tariffRate: number;
    tariff: number;
    logistics: Modes;
    /** Current landed priced at this vendor's COO. */
    current: Modes & { countryIso: string | null };
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
  baselinePcogs: number;
  /** Current landed at the incumbent's COO — the variant row's headline. */
  current: Modes & { countryIso: string | null };
  inputs: {
    htsCode: string | null;
    lengthIn: number | null;
    widthIn: number | null;
    heightIn: number | null;
    weightG: number | null;
    countryIso: string | null;
    tariffRate: number;
    logistics: Modes;
  };
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
