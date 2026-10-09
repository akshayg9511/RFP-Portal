"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Badge, Icon } from "@/ds/components";
import { useApi } from "@/lib/useApi";
import { percent } from "@/lib/format";
import { NewVendorDialog, type CreatedVendor } from "./NewVendorDialog";
import { VendorPicker } from "./VendorPicker";
import { ProductsSummary } from "./ProductsSummary";
import { AddProductsDrawer } from "./AddProductsDrawer";
import { VendorsTab } from "./VendorsTab";
import { QuoteDrawer } from "./QuoteDrawer";
import { PeoplePicker } from "@/components/PeoplePicker";

/**
 * S3 — vendor nomination and issue.
 *
 * Build Doc §5.3–5.4. Vendors come from three sources in the prototype:
 * incumbents on these styles, the vendor master by search, and new vendors
 * created with a temp code. (Recommended, the vendor x category mapping, is V1.)
 */

type RfpDetail = {
  id: string;
  name: string;
  status: string;
  instructions: string | null;
  dueDate: string | null;
  sourcingPartner: string | null;
  gm: string | null;
  sourcingPartners?: string[];
  gms?: string[];
  procurementOwners?: string[];
  templateId?: string;
  templateName: string;
  styles: {
    id: string;
    styleNumber: string;
    name: string;
    subDepartment: string;
    heroImage: string | null;
    planUnits: number | null;
    baselineFob: number | null;
  }[];
  invitations: {
    id: string;
    vendorId: string;
    vendorName: string;
    // The API has always returned these; the local type omitted them, so the
    // page could not show a vendor's code or region without a second lookup.
    vendorCode: string;
    cooRegion: string | null;
    isNewToQuince: boolean;
    isTemp: boolean;
    status: string;
    styleIds: string[];
    /** Nominated variations as `styleId|variationId`. */
    variationKeys?: string[];
    quotes: { styleId: string; status: string; fob: number | null }[];
  }[];
  candidates: {
    id: string;
    vendorCode: string;
    name: string;
    countryIso: string | null;
    cooRegion: string | null;
    isNewToQuince: boolean;
    isTemp: boolean;
    source: "INCUMBENT" | "SEARCH";
    alreadyInvited: boolean;
    clashingStyleIds: string[];
  }[];
};

/**
 * What the save actually did, including what §5.3 refused.
 *
 * Saying only "2 vendors nominated" after the server has silently dropped a
 * product is how the clash stayed invisible — the screen showed "1 of 2" and
 * never said why.
 */
function nominationMessage(body: {
  invitations: { id: string }[];
  heldBack?: { vendorName: string; rfpName: string }[];
  fullyBlocked?: { vendorName: string; rfpName: string }[];
}): string {
  const n = body.invitations.length;
  const parts = [`${n} vendor${n === 1 ? "" : "s"} nominated.`];

  const held = body.heldBack ?? [];
  if (held.length) {
    const rfps = [...new Set(held.map((h) => h.rfpName))];
    parts.push(
      `${held.length} product assignment${held.length === 1 ? "" : "s"} held back — already being quoted in ${rfps.map((r) => `"${r}"`).join(", ")}.`,
    );
  }

  for (const b of body.fullyBlocked ?? []) {
    parts.push(
      `${b.vendorName} could not be added: every product is already in "${b.rfpName}".`,
    );
  }

  return parts.join(" ");
}


export default function RfpDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, loading, error, reload } = useApi<RfpDetail>(`/api/rfps/${id}`);

  /**
   * Nomination state, as EDITS over what is saved — not a copy of it.
   *
   * This was one `picked` map rebuilt by an effect on every `data` change:
   *
   *   React.useEffect(() => { setPicked(new Map(data.invitations.map(...))) }, [data])
   *
   * So adding vendors (local only, unsaved), then creating a new vendor — which
   * calls reload() — returned fresh data, re-ran the effect, and overwrote
   * `picked` from `data.invitations`. Nothing was saved yet, so that map was
   * empty and EVERY PICK WAS SILENTLY DESTROYED. Any reload did it, not just
   * vendor creation.
   *
   * Now the saved half comes from `data` at read time and the edits survive it.
   * Removals are edits too: a deselected vendor must not reappear on the next
   * refresh, so it is tracked explicitly rather than inferred from absence.
   */
  const [added, setAdded] = React.useState<Map<string, Set<string>>>(new Map());
  const [removed, setRemoved] = React.useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [productsOpen, setProductsOpen] = React.useState(false);
  // Ownership is a SETTING, not the subject. Three input fields used to occupy
  // the top of the page.
  const [ownerOpen, setOwnerOpen] = React.useState(false);

  /**
   * Either modal surface owns the commit while it is open, so the page's own
   * actions recede. "One commit per screen" counts what is ON SCREEN, not what
   * belongs to which component.
   */
  const modalOpen = pickerOpen || dialogOpen;
  const [busy, setBusy] = React.useState(false);
  /**
   * A success is an acknowledgement — you read it and move on, so it clears
   * itself. An ERROR is something to act on, and one that vanishes while you
   * are still reading the row it refers to is worse than one that waits, so it
   * stays and carries a dismiss.
   *
   * Tone is explicit rather than guessed from the message text. It used to be
   * `message.includes("already") || message.includes("could not")`, which
   * mislabels anything phrased differently — and every error here is thrown
   * from a server message we do not control.
   */
  const [note, setNote] = React.useState<
    { tone: "ok" | "error"; text: string } | null
  >(null);

  const say = React.useCallback((tone: "ok" | "error", text: string) => {
    setNote({ tone, text });
  }, []);

  React.useEffect(() => {
    if (note?.tone !== "ok") return;
    const t = setTimeout(() => setNote(null), 3000);
    return () => clearTimeout(t);
  }, [note]);
  // Which bid is open in the drawer.
  const [openQuote, setOpenQuote] = React.useState<{
    invitationId: string;
    styleId: string;
    vendorName: string;
    tab?: "details" | "comments";
  } | null>(null);

  const issued = data?.status === "ISSUED";

  /**
   * Owners as lists (UX v2). Same rule as nomination: the saved value comes
   * from `data` at read time and a local edit overrides it, so a reload
   * mid-edit cannot wipe what was just picked.
   */
  const owners = useApi<{ sourcingPartners: string[]; gms: string[]; procurementOwners: string[] }>("/api/rfps/owners");
  const [partnerEdit, setPartnersNow] = React.useState<string[] | null>(null);
  const [gmEdit, setGmsNow] = React.useState<string[] | null>(null);
  const partnersNow =
    partnerEdit ?? data?.sourcingPartners ?? (data?.sourcingPartner ? [data.sourcingPartner] : []);
  const gmsNow = gmEdit ?? data?.gms ?? (data?.gm ? [data.gm] : []);
  const [procEdit, setProcNow] = React.useState<string[] | null>(null);
  const procNow = procEdit ?? data?.procurementOwners ?? [];

  // A create that nominated vendors may report some held back (clash with
  // another RFP); the create page passes that along in the URL once.
  React.useEffect(() => {
    const notice = new URLSearchParams(window.location.search).get("notice");
    if (!notice) return;
    // Deferred: the URL is an external system read once after mount.
    const t = setTimeout(() => setNote({ tone: "error", text: notice }), 0);
    return () => clearTimeout(t);
  }, []);

  const allStyleIds = React.useMemo(
    () => (data?.styles ?? []).map((s) => s.id),
    [data],
  );

  /** Saved invitations, merged with this session's edits. */
  const picked = React.useMemo(() => {
    const merged = new Map<string, Set<string>>();
    for (const i of data?.invitations ?? []) {
      if (!removed.has(i.vendorId)) {
        // Saved state is products PLUS their nominated variations, in the
        // same composite-key form the edits use.
        merged.set(
          i.vendorId,
          new Set([...i.styleIds, ...(i.variationKeys ?? [])]),
        );
      }
    }
    // Edits win: an edited subset replaces the saved one wholesale.
    for (const [vendorId, styleIds] of added) merged.set(vendorId, styleIds);
    return merged;
  }, [data, added, removed]);

  function toggleVendor(vendorId: string) {
    if (picked.has(vendorId)) {
      // Drop the edit AND mark it removed — dropping alone would let the saved
      // invitation resurface on the next refresh.
      setAdded((prev) => {
        const next = new Map(prev);
        next.delete(vendorId);
        return next;
      });
      setRemoved((prev) => new Set(prev).add(vendorId));
      return;
    }

    // A vendor's subset defaults to every product in the RFP, MINUS anything
    // they are already quoting elsewhere. The clash is per product (Build
    // Doc §5.3), so a vendor blocked on one product can still take the rest
    // — and the server refuses a clashing product anyway, so this cannot
    // produce a state that fails to save.
    const clashing = new Set(
      data?.candidates.find((c) => c.id === vendorId)?.clashingStyleIds ?? [],
    );
    setRemoved((prev) => {
      const next = new Set(prev);
      next.delete(vendorId);
      return next;
    });
    setAdded((prev) =>
      new Map(prev).set(
        vendorId,
        new Set(allStyleIds.filter((sid) => !clashing.has(sid))),
      ),
    );
  }

  /**
   * Toggle a product, or ONE of its variations, for a vendor.
   *
   * The nomination subset holds entries keyed `styleId` for a whole product
   * and `styleId|variationId` for a single variation. Encoding the variation
   * into the existing Set keeps the edits-over-saved merge in `picked`
   * working untouched — that pattern exists because a `reload()` used to
   * destroy unsaved picks, and widening the Map's value type would have
   * meant rewriting it.
   */
  /**
   * Materialise a whole-product hold into explicit variation keys, minus one.
   *
   * Needed because a product held WHOLE carries no variation keys — every
   * box renders checked from an implied set. Unticking one cannot be done by
   * calling the toggle N times: each call reads the same stale `picked`, so
   * React keeps only the last and "all 5" collapses to "1 of 5". One call
   * that writes the whole set is the only correct shape.
   */
  function setVariationsFor(
    vendorId: string,
    styleId: string,
    variationIds: string[],
  ) {
    const current = new Set(picked.get(vendorId) ?? []);
    for (const key of [...current]) {
      if (key.startsWith(`${styleId}|`)) current.delete(key);
    }
    if (variationIds.length) {
      current.add(styleId);
      for (const id of variationIds) current.add(`${styleId}|${id}`);
    } else {
      // No variations left means the product is out entirely.
      current.delete(styleId);
    }
    setAdded((prev) => new Map(prev).set(vendorId, current));
  }

  function toggleStyleFor(
    vendorId: string,
    styleId: string,
    variationId?: string,
  ) {
    // Start from the MERGED subset, so editing a saved vendor's products does
    // not silently reset the rest of their subset to empty.
    const current = new Set(picked.get(vendorId) ?? []);
    const key = variationId ? `${styleId}|${variationId}` : styleId;

    if (variationId) {
      if (current.has(key)) current.delete(key);
      else {
        current.add(key);
        // A variation implies the product. Without this, a vendor could hold
        // a size whose product is not in their subset, which the server
        // would reject as out of scope.
        current.add(styleId);
      }
      // The product leaves when its last variation does — a product with no
      // variations means "the whole product", the opposite of the user's act.
      const anyLeft = [...current].some((k) => k.startsWith(`${styleId}|`));
      if (!anyLeft) current.delete(styleId);
    } else if (current.has(key)) {
      current.delete(key);
      // Dropping the product drops its variations with it.
      for (const k of [...current]) {
        if (k.startsWith(`${styleId}|`)) current.delete(k);
      }
    } else {
      current.add(key);
    }

    setAdded((prev) => new Map(prev).set(vendorId, current));
  }

  async function save() {
    setBusy(true);
    setNote(null);
    try {
      const response = await fetch(`/api/rfps/${id}/invitations`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          invitations: [...picked.entries()].map(([vendorId, keys]) => ({
            vendorId,
            ...splitNominationKeys(keys),
          })),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.message ?? "Could not save");
      // Edits have landed on the server, so clear them — leaving them would
      // shadow the saved state they are now identical to, and a later removal
      // elsewhere would be masked by a stale edit.
      setAdded(new Map());
      setRemoved(new Set());
      reload();
      say("ok", nominationMessage(body));
    } catch (err: unknown) {
      say("error", err instanceof Error ? err.message : String(err));
    }
    setBusy(false);
  }

  /**
   * Add vendors to an RFP that is already out. Saves straight away, and the
   * invitations route issues each new one on creation, so the vendor sees it
   * in their portal immediately — no second Issue step (Akshay, 8 Oct).
   */
  async function addAndIssue(vendorIds: string[]) {
    const next = new Map(picked);
    for (const vid of vendorIds) {
      if (next.has(vid)) continue;
      const clashing = new Set(
        data?.candidates.find((c) => c.id === vid)?.clashingStyleIds ?? [],
      );
      next.set(vid, new Set(allStyleIds.filter((sid) => !clashing.has(sid))));
    }
    setBusy(true);
    setNote(null);
    try {
      const response = await fetch(`/api/rfps/${id}/invitations`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          invitations: [...next.entries()].map(([vendorId, keys]) => ({
            vendorId,
            ...splitNominationKeys(keys),
          })),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.message ?? "Could not add vendors");
      setAdded(new Map());
      setRemoved(new Set());
      reload();
      const n = vendorIds.length;
      say("ok", `${n} vendor${n === 1 ? "" : "s"} added and issued to.`);
    } catch (err: unknown) {
      say("error", err instanceof Error ? err.message : String(err));
    }
    setBusy(false);
  }

  /** Take a product off a draft — and off every vendor nominated for it. */
  async function removeProduct(styleId: string) {
    setBusy(true);
    setNote(null);
    try {
      const r = await fetch(`/api/rfps/${id}/styles?styleId=${encodeURIComponent(styleId)}`, {
        method: "DELETE",
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b?.message ?? "Could not remove that product");
      // Unsaved nomination edits may still hold it; drop it from them too.
      setAdded((prev) => {
        const next = new Map<string, Set<string>>();
        for (const [vid, keys] of prev) {
          next.set(vid, new Set([...keys].filter((k) => k.split("|")[0] !== styleId)));
        }
        return next;
      });
      reload();
      say("ok", "Product removed from this RFP.");
    } catch (e) {
      say("error", e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  }

  async function issue() {
    setBusy(true);
    setNote(null);
    try {
      // Nominations are saved first, so issuing never sends a stale set.
      await fetch(`/api/rfps/${id}/invitations`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          invitations: [...picked.entries()].map(([vendorId, keys]) => ({
            vendorId,
            ...splitNominationKeys(keys),
          })),
        }),
      });

      const response = await fetch(`/api/rfps/${id}/issue`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.message ?? "Could not issue");
      reload();
      // The persistent banner below already says they can see it in Vendor
      // View; repeating it here said the same thing twice.
      say("ok", `Issued to ${body.vendorCount} vendors.`);
    } catch (err: unknown) {
      say("error", err instanceof Error ? err.message : String(err));
    }
    setBusy(false);
  }

  async function patch(field: string, value: string) {
    await fetch(`/api/rfps/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
  }

  async function patchOwners(body: { sourcingPartners?: string[]; gms?: string[]; procurementOwners?: string[] }) {
    const res = await fetch(`/api/rfps/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) say("error", "Owners could not be saved. Try again.");
  }

  const candidates = data?.candidates ?? [];

  /**
   * §10.1's "vendors invited, responded and pending". Responded means at least
   * one submitted quote — a vendor part-way through has responded, they are
   * just not finished, which the completion bar per row then says.
   */
  const responded = [...picked.keys()].filter((vendorId) =>
    data?.invitations
      .find((i) => i.vendorId === vendorId)
      ?.quotes.some((q) => q.status === "SUBMITTED"),
  ).length;

  const withBids = (data?.styles ?? []).filter((style) =>
    data?.invitations.some((i) =>
      i.quotes.some((q) => q.styleId === style.id && q.status === "SUBMITTED"),
    ),
  ).length;

  const bidCount = (data?.invitations ?? []).reduce(
    (sum, i) => sum + i.quotes.filter((q) => q.status === "SUBMITTED").length,
    0,
  );

  /**
   * Lowest bid against baseline, across products that have bids. FOB against
   * FOB — never landed, which is the comparison error this build has hit five
   * times. Negative is a saving.
   */
  const lowestVsBaseline = React.useMemo(() => {
    let base = 0;
    let low = 0;
    for (const style of data?.styles ?? []) {
      if (!style.baselineFob) continue;
      const fobs = (data?.invitations ?? [])
        .flatMap((i) =>
          i.quotes.filter(
            (q) => q.styleId === style.id && q.status === "SUBMITTED",
          ),
        )
        .map((q) => q.fob)
        .filter((f): f is number => f !== null);
      if (!fobs.length) continue;
      base += style.baselineFob;
      low += Math.min(...fobs);
    }
    return base ? (low - base) / base : null;
  }, [data]);

  return (
    <>
      <div className="page-hd">
        <nav className="crumbs" aria-label="Breadcrumb">
          <Link className="crumb" href="/rfps">RFPs</Link>
        </nav>
        <div className="row">
          <div className="grow">
            <h1 className="ttl">{data?.name ?? "…"}</h1>
            {data ? (
              <p className="page-sub">
                <Badge tone={issued ? "success" : "warning"}>
                  {issued ? "Issued" : data.status === "DRAFT" ? "Draft" : data.status}
                </Badge>{" "}
                {data.templateName} · {data.styles.length} product
                {data.styles.length === 1 ? "" : "s"}
                {data.dueDate
                  ? ` · due ${new Date(data.dueDate).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                    })}`
                  : ""}
                {partnersNow.length || gmsNow.length
                  ? ` · ${[...partnersNow, ...gmsNow].join(", ")}`
                  : ""}
              </p>
            ) : null}
          </div>
          {data && !issued ? (
            /* While the picker is open it owns the commit — a page primary
               behind a modal surface is a second "one commit per screen", and
               the linter is right to flag it. */
            <div className="acts" aria-hidden={modalOpen || undefined}>
              <button
                className={modalOpen ? "btn btn--ghost" : "btn btn--secondary"}
                onClick={save}
                disabled={busy || modalOpen}
              >
                Save nominations
              </button>
              <button
                className={modalOpen ? "btn btn--ghost" : "btn btn--primary"}
                onClick={issue}
                disabled={busy || picked.size === 0 || modalOpen}
              >
                <Icon name="send" />
                Issue to {picked.size} {picked.size === 1 ? "vendor" : "vendors"}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="bar bar--danger">
          <Icon name="alert_triangle" />
          <div><strong>That RFP could not be loaded.</strong> {error}</div>
        </div>
      ) : null}

      {note ? (
        <div
          className={note.tone === "ok" ? "bar bar--success" : "bar bar--danger"}
          style={{ marginBlockEnd: "var(--space-lg)" }}
        >
          <Icon name={note.tone === "ok" ? "check_circle" : "alert_triangle"} />
          <div>{note.text}</div>
          {/* Only an error needs dismissing — a success has already gone. */}
          {note.tone === "error" ? (
            <button
              className="x"
              onClick={() => setNote(null)}
              aria-label="Dismiss"
            >
              <Icon name="close" />
            </button>
          ) : null}
        </div>
      ) : null}

      {loading ? (
        <div className="card"><div className="card-b">
          <div className="sk" style={{ blockSize: 24, inlineSize: "40%" }} />
        </div></div>
      ) : null}

      {data ? (
        <>
          {/* §10.1 asks for "vendors invited, responded and pending" — the
              reason to open an issued RFP at all, and previously absent. */}
          {issued ? (
            /* Compact tiles. This was three items at heading-2 size in a flex
               row with --space-xl between them — loose, oversized, and using
               a prominent strip to carry very little. */
            <div className="rd-summary">
              <span className="rd-tile">
                <span className="k">Responses</span>
                <span className="v">
                  {responded}
                  <span className="of">/{picked.size}</span>
                </span>
                <span className="rd-tile-bar">
                  <span
                    style={{
                      inlineSize: percent(
                        picked.size ? responded / picked.size : 0,
                        0,
                      ),
                    }}
                  />
                </span>
              </span>

              <span className="rd-tile">
                <span className="k">Bids in</span>
                <span className="v">{bidCount}</span>
                <span className="s">
                  {withBids} of {data.styles.length} products
                </span>
              </span>

              <span className="rd-tile">
                <span className="k">Lowest vs baseline</span>
                {lowestVsBaseline === null ? (
                  <span className="v rd-tile-none">—</span>
                ) : (
                  <span
                    className={
                      lowestVsBaseline < 0 ? "v rd-save" : "v rd-rise"
                    }
                  >
                    {percent(lowestVsBaseline)}
                  </span>
                )}
                <span className="s">on products with bids</span>
              </span>

              <span className="rd-tile">
                <span className="k">Due</span>
                <span className="v rd-tile-date">
                  {data.dueDate
                    ? new Date(data.dueDate).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                      })
                    : "—"}
                </span>
                <span className="s">
                  {[...partnersNow, ...gmsNow].join(" · ") || "unassigned"}
                </span>
              </span>

              <button
                className="btn btn--ghost sm rd-sum-edit"
                onClick={() => setOwnerOpen((v) => !v)}
                aria-expanded={ownerOpen}
              >
                <Icon name="edit" size="sm" />
                Ownership
              </button>
            </div>
          ) : null}

          {/* Collapsed by default once issued — these are settings. On a draft
              they are still being decided, so they stay open. */}
          {!issued || ownerOpen ? (
            <div className="card" style={{ marginBlockEnd: "var(--space-lg)" }}>
              <div className="card-h"><div className="ttl">Ownership</div></div>
              <div className="card-b">
                <div className="owner-grid">
                  {/* Lists, not one each (UX v2). Saved on every change. */}
                  <PeoplePicker
                    id="sp"
                    label="Sourcing partners"
                    addLabel="Add sourcing partner"
                    options={owners.data?.sourcingPartners ?? []}
                    value={partnersNow}
                    onChange={(next) => {
                      setPartnersNow(next);
                      patchOwners({ sourcingPartners: next });
                    }}
                  />

                  <PeoplePicker
                    id="gm"
                    label="GMs"
                    addLabel="Add GM"
                    options={owners.data?.gms ?? []}
                    value={gmsNow}
                    onChange={(next) => {
                      setGmsNow(next);
                      patchOwners({ gms: next });
                    }}
                  />

                  <PeoplePicker
                    id="po"
                    label="Procurement owners"
                    addLabel="Add procurement owner"
                    options={owners.data?.procurementOwners ?? []}
                    value={procNow}
                    onChange={(next) => {
                      setProcNow(next);
                      patchOwners({ procurementOwners: next });
                    }}
                  />

                  <div className="field">
                    <label className="lbl" htmlFor="due">Due date</label>
                    <div className="control">
                      <input
                        id="due"
                        type="date"
                        defaultValue={data.dueDate ? data.dueDate.slice(0, 10) : ""}
                        onChange={(e) => patch("dueDate", e.target.value)}
                      />
                    </div>
                    <div className="msg">Flows from the wave; editable here.</div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {/* Two tabs, and rows that expand IN PLACE — which is what makes
              tabs viable. Products answers "which vendors bid this", Vendors
              answers "which products did they quote", so the cross-question
              never needs a tab switch. */}
          {/* ONE PAGE, no tabs (Akshay, 8 Oct): what is going out at the
              top, who it is going to underneath. */}
          <ProductsSummary
            styles={data.styles}
            invitations={data.invitations}
            issued={issued}
            draft={data.status === "DRAFT"}
            busy={busy}
            onAdd={() => setProductsOpen(true)}
            onRemove={removeProduct}
          />

          <section className="card rd-vendors" aria-labelledby="rd-vendors-h">
            <div className="card-h rd-vendors-h">
              <div className="ttl" id="rd-vendors-h">
                Vendors <span className="vl-count">{picked.size}</span>
              </div>
              {picked.size > 0 ? (
                <button
                  type="button"
                  className="btn btn--secondary sm"
                  onClick={() => setPickerOpen(true)}
                >
                  <Icon name="plus" size="sm" />
                  Add vendors
                </button>
              ) : null}
            </div>
            <div className="card-b">
              {picked.size === 0 ? (
                /* The empty state IS the call to action — the old "Add
                   vendors" sat in a filter strip and read as one more filter. */
                <div className="empty">
                  <span className="glyph">
                    <Icon name="users" size="lg" />
                  </span>
                  <div className="ttl">No vendors yet</div>
                  <div className="desc">
                    Add the vendors who should quote these products.
                    {issued ? " They are issued to as soon as you add them." : ""}
                  </div>
                  <div className="acts">
                    <button
                      type="button"
                      className="btn btn--primary"
                      onClick={() => setPickerOpen(true)}
                    >
                      <Icon name="plus" />
                      Add vendors
                    </button>
                  </div>
                </div>
              ) : (
                <VendorsTab
                  styles={data.styles}
                  invitations={data.invitations}
                  candidates={candidates}
                  picked={picked}
                  issued={issued}
                  onRemove={toggleVendor}
                  onToggleStyle={toggleStyleFor}
                  onSetVariations={setVariationsFor}
                  onOpenBid={(invitationId, styleId, vendorName, tab) =>
                    setOpenQuote({ invitationId, styleId, vendorName, tab })
                  }
                  onChanged={reload}
                />
              )}
            </div>
          </section>
        </>
      ) : null}

      <VendorPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        candidates={candidates.filter((c) => !picked.has(c.id))}
        onAdd={(ids) => {
          if (issued) {
            // Already issued: adding IS issuing, so save at once rather than
            // leave an unsaved edit the vendor can never see.
            addAndIssue(ids);
            return;
          }
          for (const vid of ids) if (!picked.has(vid)) toggleVendor(vid);
        }}
        onNewVendor={() => {
          // The picker CLOSES rather than sitting behind the dialog. Both
          // surfaces live at --z-modal and both portal to body, so the drawer
          // renders over the dialog and swallows its clicks — the dialog looks
          // usable and is not. One modal surface at a time (see T11).
          setPickerOpen(false);
          setDialogOpen(true);
        }}
      />

      <QuoteDrawer
        invitationId={openQuote?.invitationId ?? null}
        styleId={openQuote?.styleId ?? null}
        vendorName={openQuote?.vendorName ?? null}
        initialTab={openQuote?.tab ?? "details"}
        onClose={() => setOpenQuote(null)}
        onChanged={reload}
      />

      <AddProductsDrawer
        open={productsOpen}
        rfpId={id}
        templateId={data?.templateId}
        onRfp={allStyleIds}
        onClose={() => setProductsOpen(false)}
        onAdded={({ added, skipped }) => {
          reload();
          const parts = [
            `${added.length} product${added.length === 1 ? "" : "s"} added.`,
            ...skipped.map((s) => `${s.styleNumber} not added: ${s.reason}.`),
          ];
          say(skipped.length ? "error" : "ok", parts.join(" "));
        }}
      />

      <NewVendorDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={(v: CreatedVendor) => {
          // The new vendor is an EDIT like any other, so the reload below
          // refreshes the candidate list without touching it — or the other
          // picks. This line used to write into a map that reload() then
          // overwrote from the server.
          setAdded((prev) => new Map(prev).set(v.id, new Set(allStyleIds)));
          reload();
          say("ok", `${v.name} added as ${v.vendorCode}, and nominated.`);
        }}
      />
    </>
  );
}

/**
 * Split the nomination Set back into the wire shape.
 *
 * Entries are `styleId` for a whole product and `styleId|variationId` for a
 * single variation. The server takes `styleIds` plus an optional
 * `variationsByStyle`, so a style-grained RFP sends exactly what it always
 * did and nothing downstream changes.
 */
function splitNominationKeys(keys: Set<string>): {
  styleIds: string[];
  variationsByStyle: Record<string, string[]>;
} {
  const styleIds = new Set<string>();
  const variationsByStyle: Record<string, string[]> = {};

  for (const key of keys) {
    const [styleId, variationId] = key.split("|");
    styleIds.add(styleId);
    if (!variationId) continue;
    (variationsByStyle[styleId] ??= []).push(variationId);
  }

  return { styleIds: [...styleIds], variationsByStyle };
}
