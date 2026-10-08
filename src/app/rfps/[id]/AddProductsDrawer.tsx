"use client";

import * as React from "react";
import { SideDrawer } from "@/components/SideDrawer";
import { Checkbox, Icon } from "@/ds/components";
import { useApi } from "@/lib/useApi";
import { units } from "@/lib/format";

type CatalogStyle = {
  id: string;
  styleNumber: string;
  name: string;
  subDepartment: string;
  heroImage: string | null;
  planUnits: number | null;
};

/**
 * Add products to a DRAFT RFP — the same drawer shape as Add vendors, so the
 * RFP page has one way to add things (Akshay, 8 Oct: "why do you have two
 * UX?"). Only products that use this RFP's quotation template are added;
 * the server says which were skipped and why.
 */
export function AddProductsDrawer({
  open,
  rfpId,
  templateId,
  onRfp,
  onClose,
  onAdded,
}: {
  open: boolean;
  rfpId: string;
  /** The RFP's quotation template — only products on it are offered. */
  templateId: string | undefined;
  /** Product ids already on the RFP — not offered again. */
  onRfp: string[];
  onClose: () => void;
  onAdded: (result: { added: string[]; skipped: { styleNumber: string; reason: string }[] }) => void;
}) {
  const catalog = useApi<{ styles: CatalogStyle[] }>(
    open && templateId ? `/api/styles?templateId=${encodeURIComponent(templateId)}` : null,
  );
  const [query, setQuery] = React.useState("");
  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const rows = (catalog.data?.styles ?? [])
    .filter((s) => !onRfp.includes(s.id))
    .filter(
      (s) => !q || s.styleNumber.toLowerCase().includes(q) || s.name.toLowerCase().includes(q),
    );

  function close() {
    setPicked(new Set());
    setQuery("");
    setError(null);
    onClose();
  }

  async function add() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/rfps/${rfpId}/styles`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ styleIds: [...picked] }),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b?.message ?? "Could not add products");
      onAdded(b);
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add products");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SideDrawer
      open={open}
      onClose={close}
      title="Add products"
      sub="Products that use this RFP's quotation template"
      footer={
        <>
          <button type="button" className="btn btn--secondary" onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={!picked.size || busy}
            onClick={add}
          >
            {busy
              ? "Adding…"
              : picked.size
                ? `Add ${picked.size} product${picked.size === 1 ? "" : "s"}`
                : "Add products"}
          </button>
        </>
      }
    >
      <div className="control search ap-search">
        <Icon name="search" size="sm" />
        <input
          placeholder="Search style number or name"
          aria-label="Search the catalog"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {error ? (
        <div className="bar bar--danger">
          <Icon name="alert_triangle" />
          <div>{error}</div>
        </div>
      ) : null}
      {catalog.loading ? <div className="sk" style={{ blockSize: 240 }} /> : null}
      <ul className="ap-list">
        {rows.map((s) => {
          const on = picked.has(s.id);
          const cid = `ap-${s.id}`;
          return (
            <li className={on ? "ap-row on" : "ap-row"} key={s.id}>
              <Checkbox
                id={cid}
                checked={on}
                onChange={() =>
                  setPicked((prev) => {
                    const next = new Set(prev);
                    if (next.has(s.id)) next.delete(s.id);
                    else next.add(s.id);
                    return next;
                  })
                }
              />
              {s.heroImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="aw-thumb" src={s.heroImage} alt="" loading="lazy" />
              ) : (
                <span className="aw-thumb aw-thumb--empty" />
              )}
              <label htmlFor={cid} className="ap-id">
                <span className="rd-pname">
                  <span className="id">{s.styleNumber}</span> {s.name}
                </span>
                <span className="rd-pmeta">
                  {s.subDepartment} · {s.planUnits ? `${units(s.planUnits)} units/yr` : "—"}
                </span>
              </label>
            </li>
          );
        })}
        {!catalog.loading && rows.length === 0 ? (
          <li className="rd-pempty">No products match.</li>
        ) : null}
      </ul>
    </SideDrawer>
  );
}
