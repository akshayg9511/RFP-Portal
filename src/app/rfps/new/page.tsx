"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/ds/components";
import { useSelection } from "@/lib/selection";
import { useApi } from "@/lib/useApi";
import { PeoplePicker } from "@/components/PeoplePicker";
import { RfpGroup, type SplitGroup } from "./RfpGroup";

/**
 * S2 — selection to RFPs.
 *
 * The split preview is demo moment #1: a selection divides by template, and
 * the user sees the division and the resolution path BEFORE anything is
 * committed. Ends at RFPs created in draft; nomination and issue are S3.
 */

type SplitPreview = {
  totalStyles: number;
  rfpCount: number;
  groups: SplitGroup[];
  unresolved: { id: string; styleNumber: string; name: string }[];
};

export default function NewRfpPage() {
  const router = useRouter();
  const selection = useSelection();

  const [preview, setPreview] = React.useState<SplitPreview | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [names, setNames] = React.useState<Record<string, string>>({});
  const [instructions, setInstructions] = React.useState<Record<string, string>>({});
  const [creating, setCreating] = React.useState(false);

  /**
   * UX v2 create form. Akshay, 8 Oct: creating an RFP should ask for the
   * owners, due date and instructions up front and land on the draft — not bounce to the RFP list and make the buyer find it again.
   * Owners and due date are shared by every RFP this create makes; name and
   * instructions are per RFP. Vendors are added on the RFP page itself.
   */
  const owners = useApi<{ sourcingPartners: string[]; gms: string[]; procurementOwners: string[] }>("/api/rfps/owners");
  const [partners, setPartners] = React.useState<string[]>([]);
  const [gms, setGms] = React.useState<string[]>([]);
  const [procurement, setProcurement] = React.useState<string[]>([]);
  const [dueDate, setDueDate] = React.useState("");

  /**
   * Variations DESELECTED on this screen, by styleId.
   *
   * Exclusions rather than inclusions: a product arrives fully included,
   * which is what the catalog selection already decided. Aravind was
   * explicit that re-picking everything here is cumbersome — this screen is
   * for review and the occasional "not that size".
   */
  const [dropped, setDropped] = React.useState<Record<string, string[]>>({});

  /**
   * The exclusions that APPLY, derived rather than stored.
   *
   * The catalog's narrowing and this screen's unticks are two different
   * facts, so merging them during render beats seeding state from an effect:
   * no cascading render, and the screen can never disagree with the payload
   * about what is going out. `dropped` holds only what was unticked HERE.
   *
   * Without this the screen showed "5 of 5 sizes" for a product narrowed to
   * 3 in the catalog, while the payload still honoured the 3 — the two
   * disagreed, which is the bug a browser caught and no API test would.
   */
  const effectiveDropped = React.useMemo(() => {
    const merged: Record<string, string[]> = {};
    for (const group of preview?.groups ?? []) {
      for (const style of group.styles) {
        const all = (style.variations ?? []).map((v) => v.id);
        if (!all.length) continue;
        const picked = selection.selected.get(style.id)?.variationIds ?? [];
        // Nothing picked in the catalog means the whole product.
        const fromCatalog = picked.length ? all.filter((id) => !picked.includes(id)) : [];
        const fromHere = dropped[style.id] ?? [];
        const out = [...new Set([...fromCatalog, ...fromHere])];
        if (out.length) merged[style.id] = out;
      }
    }
    return merged;
  }, [preview, dropped, selection.selected]);

  function toggleVariation(styleId: string, variationId: string) {
    setDropped((prev) => {
      const current = prev[styleId] ?? [];
      const next = current.includes(variationId)
        ? current.filter((id) => id !== variationId)
        : [...current, variationId];
      const copy = { ...prev };
      if (next.length) copy[styleId] = next;
      else delete copy[styleId];
      return copy;
    });
  }

  const styleIds = React.useMemo(
    () => [...selection.selected.keys()],
    [selection.selected],
  );

  React.useEffect(() => {
    if (!styleIds.length) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch("/api/rfps/split-preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ styleIds }),
    })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body?.message ?? "Preview failed");
        return body as SplitPreview;
      })
      .then((body) => {
        if (cancelled) return;
        setPreview(body);
        setNames(
          Object.fromEntries(
            body.groups.map((g) => [g.templateId, g.suggestedName]),
          ),
        );
        setInstructions(
          Object.fromEntries(body.groups.map((g) => [g.templateId, ""])),
        );
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [styleIds]);

  async function create() {
    if (!preview) return;
    setCreating(true);
    setError(null);

    try {
      const response = await fetch("/api/rfps", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          groups: preview.groups.map((g) => ({
            templateId: g.templateId,
            name: names[g.templateId],
            instructions: instructions[g.templateId] ?? "",
            styleIds: g.styles.map((s) => s.id),
            // Carry the variation picks through. A style the selection holds
            // at variation level goes out to bid on exactly those; one held
            // whole is absent from this map and goes out whole.
            variationsByStyle: Object.fromEntries(
              g.styles
                .map((s) => {
                  // Start from whatever the catalog picked; if it picked
                  // nothing the product is going out whole, so the group's
                  // own variation list is the starting set.
                  // ONE source for "what is going out", shared with the
                  // table above, so the screen and the payload cannot drift.
                  const all = (s.variations ?? []).map((v) => v.id);
                  const out = effectiveDropped[s.id] ?? [];
                  return [s.id, all.filter((id) => !out.includes(id))] as const;
                })
                // An empty list means "the whole product", so only send a
                // style that genuinely has a narrowed set.
                .filter(([, picked]) => picked.length > 0),
            ),
          })),
          sourcingPartners: partners,
          gms,
          procurementOwners: procurement,
          dueDate: dueDate || null,
        }),
      });

      const body = await response.json();
      if (!response.ok) throw new Error(body?.message ?? "Could not create");

      const created = (body.created ?? []) as { id: string; name: string }[];

      selection.clear();
      // One RFP → straight to its draft. Several → the list, where the buyer
      // completes each one in turn (Akshay, 8 Oct).
      // Vendors are added on the RFP page — one way to add them, not two
      // (Akshay, 8 Oct: "why do you have two UX?").
      if (created.length === 1) {
        router.push(`/rfps/${created[0].id}`);
      } else {
        router.push(`/rfps?created=${created.map((c) => c.id).join(",")}`);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setCreating(false);
    }
  }

  if (!styleIds.length) {
    return (
      <>
        <div className="page-hd">
          <h1>Create RFP</h1>
        </div>
        <div className="card">
          <div className="card-b">
            <div className="empty">
              <span className="glyph">
                <Icon name="invoice" size="lg" />
              </span>
              <div className="ttl">Nothing selected</div>
              <div className="desc">
                Choose the styles to bid on, then come back here. The
                selection splits into one RFP per quotation template.
              </div>
              <div className="acts">
                <Link className="btn btn--secondary" href="/style-sets">
                  Browse style sets
                </Link>
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  const missingName = preview?.groups.some((g) => !names[g.templateId]?.trim());
  // What still blocks Create, said in words beside the button rather than
  // only as a disabled state.
  const missing = [
    missingName ? "a name for every RFP" : null,
    partners.length ? null : "a sourcing partner",
    gms.length ? null : "a GM",
    dueDate ? null : "a due date",
  ].filter(Boolean) as string[];

  return (
    <>
      <div className="page-hd">
        <nav className="crumbs" aria-label="Breadcrumb">
          <Link className="crumb" href="/style-sets">
            Style sets
          </Link>
        </nav>
        <div className="row">
          <div className="grow">
            <h1 className="ttl">Create RFP</h1>
          </div>
        </div>
      </div>

      {error ? (
        <div className="bar bar--danger" style={{ marginBlockEnd: "var(--space-lg)" }}>
          <Icon name="alert_triangle" />
          <div>
            <strong>That did not work.</strong> {error}
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="card">
          <div className="card-b">
            <div className="sk" style={{ blockSize: 28, inlineSize: "45%" }} />
            <div
              className="sk"
              style={{
                blockSize: 16,
                inlineSize: "80%",
                marginBlockStart: "var(--space-md)",
              }}
            />
          </div>
        </div>
      ) : null}

      {preview ? (
        <>
          {/* The split, stated before anything is committed. */}
          <div className="card raised" style={{ marginBlockEnd: "var(--space-lg)" }}>
            <div className="card-b">
              <div className="split-headline">
                <span className="v">{preview.totalStyles}</span>
                <span className="k">styles</span>
                <Icon name="arrow_right" />
                <span className="v">{preview.rfpCount}</span>
                <span className="k">
                  {preview.rfpCount === 1 ? "RFP" : "RFPs"}
                </span>
              </div>
              <p style={{ color: "var(--color-neutral-foreground-muted-enabled)", marginBlockStart: "var(--space-sm)" }}>
                {preview.rfpCount > 1
                  ? "These styles use different quotation templates, so they become separate RFPs. Each vendor sees only the styles in their RFP."
                  : "All of these styles share one quotation template."}
              </p>
            </div>
          </div>

          {preview.unresolved.length ? (
            <div className="bar bar--warning" style={{ marginBlockEnd: "var(--space-lg)" }}>
              <Icon name="alert_triangle" />
              <div>
                <strong>
                  {preview.unresolved.length} style
                  {preview.unresolved.length === 1 ? "" : "s"} have no template.
                </strong>{" "}
                They will be left out:{" "}
                {preview.unresolved.map((s) => s.styleNumber).join(", ")}
              </div>
            </div>
          ) : null}

          <div className="card" style={{ marginBlockEnd: "var(--space-lg)" }}>
            <div className="card-h">
              <div className="ttl">Owners and due date</div>
            </div>
            <div className="card-b rfp-create-owners">
              <PeoplePicker
                id="rfp-partners"
                label="Sourcing partners"
                addLabel="Add sourcing partner"
                options={owners.data?.sourcingPartners ?? []}
                value={partners}
                onChange={setPartners}
              />
              <PeoplePicker
                id="rfp-gms"
                label="GMs"
                addLabel="Add GM"
                options={owners.data?.gms ?? []}
                value={gms}
                onChange={setGms}
              />
              <PeoplePicker
                id="rfp-procurement"
                label="Procurement owners (optional)"
                addLabel="Add procurement owner"
                options={owners.data?.procurementOwners ?? []}
                value={procurement}
                onChange={setProcurement}
              />
              <div className="field">
                <label className="lbl" htmlFor="rfp-due">
                  Due date
                </label>
                <div className="control">
                  <input
                    id="rfp-due"
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                  />
                </div>
              </div>
            </div>
            {preview.rfpCount > 1 ? (
              <div className="card-b rfp-create-note">
                These apply to all {preview.rfpCount} RFPs. You can change them on
                each RFP afterwards.
              </div>
            ) : null}
          </div>

          {preview.groups.map((group) => (
            <RfpGroup
              key={group.templateId}
              group={group}
              name={names[group.templateId] ?? ""}
              onNameChange={(value) =>
                setNames((prev) => ({ ...prev, [group.templateId]: value }))
              }
              instructions={instructions[group.templateId] ?? ""}
              onInstructionsChange={(value) =>
                setInstructions((prev) => ({
                  ...prev,
                  [group.templateId]: value,
                }))
              }
            dropped={effectiveDropped}
            onToggleVariation={toggleVariation}
            />
          ))}

          <div className="page-actions">
            <Link className="btn btn--secondary" href="/style-sets">
              Back to selection
            </Link>
            {missing.length ? (
              <span className="rfp-create-missing">Add {missing.join(", ")}</span>
            ) : null}
            <button
              className="btn btn--primary"
              onClick={create}
              disabled={creating || missing.length > 0}
            >
              {creating ? (
                <>
                  <span className="spinner" aria-hidden />
                  Creating…
                </>
              ) : preview.rfpCount === 1 ? (
                "Create draft"
              ) : (
                `Create ${preview.rfpCount} drafts`
              )}
            </button>
          </div>
        </>
      ) : null}
    </>
  );
}
