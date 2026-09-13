"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Badge, Checkbox, Icon } from "@/ds/components";
import { useApi } from "@/lib/useApi";
import { money, units } from "@/lib/format";
import { NewVendorDialog, type CreatedVendor } from "./NewVendorDialog";

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
    status: string;
    styleIds: string[];
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

const QUINCE_PEOPLE = [
  "Tony Alvarez",
  "Jeremiah Cole",
  "Jackie Chen",
  "Priya Raman",
];

export default function RfpDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data, loading, error, reload } = useApi<RfpDetail>(`/api/rfps/${id}`);

  const [picked, setPicked] = React.useState<Map<string, Set<string>>>(new Map());
  const [query, setQuery] = React.useState("");
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [subsetFor, setSubsetFor] = React.useState<string | null>(null);

  const issued = data?.status === "ISSUED";

  // Seed the working set from whatever is already nominated.
  React.useEffect(() => {
    if (!data) return;
    setPicked(
      new Map(data.invitations.map((i) => [i.vendorId, new Set(i.styleIds)])),
    );
  }, [data]);

  const allStyleIds = React.useMemo(
    () => (data?.styles ?? []).map((s) => s.id),
    [data],
  );

  function toggleVendor(vendorId: string) {
    setPicked((prev) => {
      const next = new Map(prev);
      if (next.has(vendorId)) next.delete(vendorId);
      // A vendor's subset defaults to every product in the RFP.
      else next.set(vendorId, new Set(allStyleIds));
      return next;
    });
  }

  function toggleStyleFor(vendorId: string, styleId: string) {
    setPicked((prev) => {
      const next = new Map(prev);
      const set = new Set(next.get(vendorId) ?? []);
      if (set.has(styleId)) set.delete(styleId);
      else set.add(styleId);
      next.set(vendorId, set);
      return next;
    });
  }

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/rfps/${id}/invitations`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          invitations: [...picked.entries()].map(([vendorId, styleIds]) => ({
            vendorId,
            styleIds: [...styleIds],
          })),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.message ?? "Could not save");
      reload();
      setMessage(`${body.invitations.length} vendors nominated.`);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : String(err));
    }
    setBusy(false);
  }

  async function issue() {
    setBusy(true);
    setMessage(null);
    try {
      // Nominations are saved first, so issuing never sends a stale set.
      await fetch(`/api/rfps/${id}/invitations`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          invitations: [...picked.entries()].map(([vendorId, styleIds]) => ({
            vendorId,
            styleIds: [...styleIds],
          })),
        }),
      });

      const response = await fetch(`/api/rfps/${id}/issue`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.message ?? "Could not issue");
      reload();
      setMessage(
        `Issued to ${body.vendorCount} vendors. They can see it in Vendor View now.`,
      );
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : String(err));
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

  const candidates = (data?.candidates ?? []).filter((c) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) || c.vendorCode.toLowerCase().includes(q)
    );
  });

  const incumbents = candidates.filter((c) => c.source === "INCUMBENT");
  const others = candidates.filter((c) => c.source === "SEARCH");

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
                {data.templateName} · {data.styles.length} products ·{" "}
                <Badge tone={issued ? "success" : undefined}>{data.status}</Badge>
              </p>
            ) : null}
          </div>
          {data && !issued ? (
            <div className="acts">
              <button className="btn btn--secondary" onClick={save} disabled={busy}>
                Save nominations
              </button>
              <button
                className="btn btn--primary"
                onClick={issue}
                disabled={busy || picked.size === 0}
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

      {message ? (
        <div
          className={message.includes("already") || message.includes("could not")
            ? "bar bar--danger"
            : "bar bar--success"}
          style={{ marginBlockEnd: "var(--space-lg)" }}
        >
          <Icon name={message.includes("already") ? "alert_triangle" : "check_circle"} />
          <div>{message}</div>
        </div>
      ) : null}

      {loading ? (
        <div className="card"><div className="card-b">
          <div className="sk" style={{ blockSize: 24, inlineSize: "40%" }} />
        </div></div>
      ) : null}

      {data ? (
        <>
          {issued ? (
            <div className="bar bar--info" style={{ marginBlockEnd: "var(--space-lg)" }}>
              <Icon name="info_circle" />
              <div>
                <strong>Issued.</strong> {data.invitations.length} vendors can
                see this RFP. Switch to Vendor View to bid as one of them.
              </div>
            </div>
          ) : null}

          {/* Owners and dates */}
          <div className="card" style={{ marginBlockEnd: "var(--space-lg)" }}>
            <div className="card-h"><div className="ttl">Ownership</div></div>
            <div className="card-b">
              <div className="owner-grid">
                <div className="field">
                  <label className="lbl" htmlFor="sp">Sourcing partner</label>
                  <div className="control control-select">
                    <select
                      id="sp"
                      defaultValue={data.sourcingPartner ?? ""}
                      disabled={issued}
                      onChange={(e) => patch("sourcingPartner", e.target.value)}
                    >
                      <option value="">Unassigned</option>
                      {QUINCE_PEOPLE.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                </div>

                <div className="field">
                  <label className="lbl" htmlFor="gm">GM</label>
                  <div className="control control-select">
                    <select
                      id="gm"
                      defaultValue={data.gm ?? ""}
                      disabled={issued}
                      onChange={(e) => patch("gm", e.target.value)}
                    >
                      <option value="">Unassigned</option>
                      {QUINCE_PEOPLE.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                </div>

                <div className="field">
                  <label className="lbl" htmlFor="due">Due date</label>
                  <div className="control">
                    <input
                      id="due"
                      type="date"
                      disabled={issued}
                      defaultValue={data.dueDate ? data.dueDate.slice(0, 10) : ""}
                      onChange={(e) => patch("dueDate", e.target.value)}
                    />
                  </div>
                  <div className="msg">Flows from the wave; editable here.</div>
                </div>
              </div>
            </div>
          </div>

          {/* Nomination */}
          <div className="card" style={{ marginBlockEnd: "var(--space-lg)" }}>
            <div className="card-h">
              <div className="ttl">Vendors</div>
              <div className="sub">
                {picked.size} nominated · each gets every product unless you
                narrow it
              </div>
            </div>

            <div className="card-b">
              <div className="filter-bar" style={{ marginBlockEnd: "var(--space-md)" }}>
                <div className="fb-filters">
                  <div className="control search sm">
                    <Icon name="search" size="sm" />
                    <input
                      placeholder="Search the vendor master"
                      aria-label="Search vendors"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </div>
                </div>
                <div className="fb-actions">
                  <button
                    className="btn btn--ghost btn--sm"
                    onClick={() => setDialogOpen(true)}
                    disabled={issued}
                  >
                    <Icon name="plus" />
                    New vendor
                  </button>
                </div>
              </div>

              {incumbents.length ? (
                <>
                  <div className="vendor-group-label">
                    Currently supplying these styles
                  </div>
                  {incumbents.map((c) => (
                    <VendorRow
                      key={c.id}
                      candidate={c}
                      picked={picked}
                      styles={data.styles}
                      disabled={issued}
                      onToggle={toggleVendor}
                      onOpenSubset={setSubsetFor}
                      subsetOpen={subsetFor === c.id}
                      onToggleStyle={toggleStyleFor}
                    />
                  ))}
                </>
              ) : null}

              <div className="vendor-group-label">Vendor master</div>
              {others.slice(0, query ? 40 : 12).map((c) => (
                <VendorRow
                  key={c.id}
                  candidate={c}
                  picked={picked}
                  styles={data.styles}
                  disabled={issued}
                  onToggle={toggleVendor}
                  onOpenSubset={setSubsetFor}
                  subsetOpen={subsetFor === c.id}
                  onToggleStyle={toggleStyleFor}
                />
              ))}
              {!query && others.length > 12 ? (
                <p style={{ color: "var(--color-fg-muted)" }}>
                  {others.length - 12} more — search to narrow.
                </p>
              ) : null}
            </div>
          </div>

          {/* Products */}
          <div className="card" style={{ marginBlockEnd: "var(--space-2xl)" }}>
            <div className="card-h">
              <div className="ttl">Products</div>
              <div className="sub">{data.styles.length} in this RFP</div>
            </div>
            <div className="data-grid-surface">
              <table className="data-grid">
                <thead>
                  <tr>
                    <th>Style</th>
                    <th>Sub-department</th>
                    <th className="num">Plan units</th>
                    <th className="num">Baseline FOB</th>
                  </tr>
                </thead>
                <tbody>
                  {data.styles.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <span className="id">{s.styleNumber}</span> · {s.name}
                      </td>
                      <td>{s.subDepartment}</td>
                      <td className="num">{units(s.planUnits)}</td>
                      <td className="num">
                        {s.baselineFob ? `$${s.baselineFob.toFixed(2)}` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}

      <NewVendorDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={(v: CreatedVendor) => {
          setPicked((prev) => new Map(prev).set(v.id, new Set(allStyleIds)));
          reload();
          setMessage(`${v.name} added as ${v.vendorCode}, and nominated.`);
        }}
      />
    </>
  );
}

function VendorRow({
  candidate,
  picked,
  styles,
  disabled,
  onToggle,
  onOpenSubset,
  subsetOpen,
  onToggleStyle,
}: {
  candidate: RfpDetail["candidates"][number];
  picked: Map<string, Set<string>>;
  styles: RfpDetail["styles"];
  disabled: boolean;
  onToggle: (vendorId: string) => void;
  onOpenSubset: (vendorId: string | null) => void;
  subsetOpen: boolean;
  onToggleStyle: (vendorId: string, styleId: string) => void;
}) {
  const isPicked = picked.has(candidate.id);
  const subset = picked.get(candidate.id);
  const blocked = candidate.clashingStyleIds.length > 0 && !isPicked;

  return (
    <div className={isPicked ? "vendor-row on" : "vendor-row"}>
      <div className="vendor-row-main">
        <Checkbox
          checked={isPicked}
          disabled={disabled || blocked}
          onChange={() => onToggle(candidate.id)}
          aria-label={`Nominate ${candidate.name}`}
        />
        <div className="vendor-row-id">
          <span className="nm">{candidate.name}</span>
          <span className="meta">
            {candidate.vendorCode} · {candidate.countryIso ?? "—"}
          </span>
        </div>

        <div className="vendor-row-tags">
          {candidate.isTemp ? <Badge tone="info">Temp code</Badge> : null}
          {candidate.isNewToQuince ? <Badge>New</Badge> : null}
          {candidate.source === "INCUMBENT" ? (
            <Badge tone="success">Incumbent</Badge>
          ) : null}
        </div>

        {isPicked && subset ? (
          <button
            className="btn btn--ghost btn--sm"
            onClick={() => onOpenSubset(subsetOpen ? null : candidate.id)}
            disabled={disabled}
          >
            {subset.size === styles.length
              ? "All products"
              : `${subset.size} of ${styles.length}`}
            <Icon name="chevron_down" size="sm" />
          </button>
        ) : null}
      </div>

      {blocked ? (
        <div className="vendor-row-note">
          Already bidding on {candidate.clashingStyleIds.length} of these
          products in another RFP.
        </div>
      ) : null}

      {subsetOpen && subset ? (
        <div className="vendor-subset">
          {styles.map((s) => (
            <label key={s.id} className="vendor-subset-item">
              <Checkbox
                checked={subset.has(s.id)}
                onChange={() => onToggleStyle(candidate.id, s.id)}
                aria-label={s.name}
              />
              <span className="id">{s.styleNumber}</span>
              <span>{s.name}</span>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}
