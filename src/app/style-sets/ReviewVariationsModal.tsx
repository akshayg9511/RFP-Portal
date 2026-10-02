"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Checkbox, Icon } from "@/ds/components";
import { useSelection } from "@/lib/selection";
import { units } from "@/lib/format";

/**
 * REVIEW VARIATION LEVEL — the last look before an RFP is raised.
 *
 * Reached from the selection tray, beside Create RFP. Create RFP sends every
 * variation of every selected product; this is the path for "all of it
 * except King".
 *
 * Everything arrives PRE-CHECKED. Aravind was explicit that making someone
 * re-pick what they already chose is cumbersome — this screen is review, not
 * re-entry. Unchecking is the only work.
 *
 * A Modal, not a SideDrawer: the tray is not a drawer, a form belongs on a
 * modal surface, and `SideDrawer` cannot nest (T11).
 */

/**
 * Exactly what GET /api/styles/[id]/variations returns.
 *
 * NOTE `key`, not `id`. An earlier version of this type declared `id`, which
 * does not exist on the payload — so `g.id` was undefined for every group and
 * React saw a list of identical keys. The type has to match the endpoint.
 */
type Group = {
  key: string;
  label: string;
  variationIds: string[];
  skuCount: number;
  planUnits: number;
};

type Payload = { grain: string; groups: Group[] };

export function ReviewVariationsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  // Mounted only while open, so React discards the draft on close rather
  // than an effect resetting it — the pattern SaveAsSetDialog documents.
  if (!open) return null;
  return <ReviewVariationsForm onClose={onClose} />;
}

function ReviewVariationsForm({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const selection = useSelection();

  const products = React.useMemo(
    () => [...selection.selected.values()],
    [selection.selected],
  );

  const [loaded, setLoaded] = React.useState<Record<string, Payload>>({});
  const [loading, setLoading] = React.useState(true);

  // One fetch per selected product. They are few — a selection is a handful
  // of products, not the catalogue — and /api/styles/[id]/variations is the
  // same endpoint the catalog rows already use.
  React.useEffect(() => {
    let cancelled = false;
    Promise.all(
      products.map((p) =>
        fetch(`/api/styles/${p.id}/variations`)
          .then((r) => r.json())
          .then((body: Payload) => [p.id, body] as const)
          .catch(() => [p.id, { grain: "STYLE", groups: [] }] as const),
      ),
    ).then((entries) => {
      if (cancelled) return;
      setLoaded(Object.fromEntries(entries));
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Which variations are UNCHECKED, by styleId.
   *
   * Exclusions rather than inclusions, so a product arrives fully included
   * without this component having to seed state from the fetch.
   */
  const [dropped, setDropped] = React.useState<Record<string, string[]>>({});

  function toggle(styleId: string, variationId: string) {
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

  // A product with every variation unchecked would go out as nothing, so the
  // commit is blocked rather than silently sending an empty product.
  const emptied = products.filter((p) => {
    const groups = loaded[p.id]?.groups ?? [];
    if (groups.length < 2) return false;
    return (dropped[p.id] ?? []).length === groups.length;
  });

  const skuTotal = products.reduce((total, p) => {
    const groups = loaded[p.id]?.groups ?? [];
    if (groups.length < 2) return total;
    return total + groups.length - (dropped[p.id] ?? []).length;
  }, 0);

  function create() {
    // Write the surviving variations into the shared selection, so this
    // modal and the plain Create RFP path converge on ONE payload. Two code
    // paths for one decision is how they drift.
    for (const product of products) {
      const groups = loaded[product.id]?.groups ?? [];
      if (groups.length < 2) continue;
      const out = dropped[product.id] ?? [];
      const keep = groups
        .filter((g) => !out.includes(g.key))
        .flatMap((g) => g.variationIds);
      selection.selectAllVariations(product, keep);
    }
    onClose();
    router.push("/rfps/new");
  }

  return (
    <div
      className="scrim app-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rv-title"
      >
        <div className="modal-h">
          <div className="ttl" id="rv-title">
            Review variation level
          </div>
          <button className="x" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>

        <div className="modal-b">
          <p className="rv-lede">
            Everything is included. Uncheck anything that should not go out to
            bid — a size a vendor cannot make, or a colour that is not in this
            wave.
          </p>

          {loading ? (
            <div className="sk" style={{ blockSize: 120 }} />
          ) : (
            products.map((product) => {
              const payload = loaded[product.id];
              const groups = payload?.groups ?? [];
              const out = dropped[product.id] ?? [];
              // A STYLE-grain product has nothing finer to choose.
              const atStyleLevel = groups.length < 2;

              return (
                <div className="rv-product" key={`p-${product.id}`}>
                  <div className="rv-product-h">
                    <span className="id">{product.styleNumber}</span>
                    <span className="rv-name">{product.name}</span>
                    {!atStyleLevel ? (
                      <span className="rv-count">
                        {groups.length - out.length} of {groups.length}
                      </span>
                    ) : null}
                  </div>

                  {atStyleLevel ? (
                    <p className="rv-whole">
                      Bid at product level — nothing to choose.
                    </p>
                  ) : (
                    <div className="rv-vars">
                      {groups.map((g) => (
                        <label className="rv-var" key={`${product.id}-${g.key}`}>
                          <Checkbox
                            checked={!out.includes(g.key)}
                            onChange={() => toggle(product.id, g.key)}
                            aria-label={`Include ${g.label} of ${product.name}`}
                          />
                          <span className="rv-var-label">{g.label}</span>
                          <span className="rv-var-meta">
                            {units(g.planUnits)} units
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}

          {emptied.length ? (
            <div className="bar bar--danger">
              <span>
                {emptied.map((p) => p.styleNumber).join(", ")} would go out with
                no variations. Keep at least one, or remove the product from
                the selection.
              </span>
            </div>
          ) : null}
        </div>

        {/* No Cancel — the header x dismisses, and the footer is spent on the
            commit. Two dismissals for one job is the thing the system's own
            guidance warns against. */}
        <div className="modal-f">
          <button
            className="btn btn--primary"
            onClick={create}
            disabled={loading || emptied.length > 0 || products.length === 0}
          >
            Create RFP · {products.length} product
            {products.length === 1 ? "" : "s"}
            {skuTotal ? ` · ${skuTotal} SKUs` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}
