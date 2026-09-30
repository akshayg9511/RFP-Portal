import { describe, expect, it } from "vitest";

/**
 * The award-release rule, as pure logic.
 *
 * The API does the database work, but the DECISION — who is told what — is the
 * part that must not drift, because it is the only place a vendor learns an
 * outcome. Extracted here so it is testable without a database.
 *
 * Until this shipped, `Invitation.status` declared AWARDED | NOT_PROCEEDING and
 * the vendor dashboard had labels for both, but nothing in the codebase ever
 * wrote either value. A vendor bid and then heard nothing, forever.
 */

type Line = { vendorId: string; awardPct: number };
type Invite = { id: string; vendorId: string };

export function releaseOutcomes(
  lines: Line[],
  invited: Invite[],
): { id: string; status: "AWARDED" | "NOT_PROCEEDING" }[] {
  const winners = new Set(lines.filter((l) => l.awardPct > 0).map((l) => l.vendorId));
  return invited.map((inv) => ({
    id: inv.id,
    status: winners.has(inv.vendorId) ? "AWARDED" : "NOT_PROCEEDING",
  }));
}

const invited: Invite[] = [
  { id: "i1", vendorId: "v1" },
  { id: "i2", vendorId: "v2" },
  { id: "i3", vendorId: "v3" },
];

describe("releasing an award tells everyone who quoted", () => {
  it("winners are AWARDED", () => {
    const out = releaseOutcomes(
      [
        { vendorId: "v1", awardPct: 60 },
        { vendorId: "v2", awardPct: 40 },
      ],
      invited,
    );
    expect(out.find((o) => o.id === "i1")!.status).toBe("AWARDED");
    expect(out.find((o) => o.id === "i2")!.status).toBe("AWARDED");
  });

  it("a vendor who bid and lost is told, not left silent", () => {
    // The failure mode this prevents: telling the winners and forgetting
    // everyone else, which is what the workbook does today.
    const out = releaseOutcomes([{ vendorId: "v1", awardPct: 100 }], invited);
    expect(out.find((o) => o.id === "i3")!.status).toBe("NOT_PROCEEDING");
  });

  it("a zero-percent line is NOT a win", () => {
    // Removing a vendor from a split is expressed as 0%, and a 0% award row
    // must never read as having won something.
    const out = releaseOutcomes(
      [
        { vendorId: "v1", awardPct: 100 },
        { vendorId: "v2", awardPct: 0 },
      ],
      invited,
    );
    expect(out.find((o) => o.id === "i2")!.status).toBe("NOT_PROCEEDING");
  });

  it("every invited vendor gets exactly one outcome", () => {
    const out = releaseOutcomes([{ vendorId: "v1", awardPct: 100 }], invited);
    expect(out).toHaveLength(invited.length);
    expect(new Set(out.map((o) => o.id)).size).toBe(invited.length);
  });
});
