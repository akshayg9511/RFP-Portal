"use client";

import Link from "next/link";
import { Badge, Icon } from "@/ds/components";
import { useApi } from "@/lib/useApi";
import { useVendorView } from "@/lib/vendorView";
import { percent, unitCost, units } from "@/lib/format";

/**
 * S4 — the vendor dashboard.
 *
 * Reads vendorId from the Vendor View context and nothing else, so in V1 the
 * identity resolves from the session instead and this screen is unchanged.
 */

type Invitation = {
  id: string;
  status: string;
  currentRound: number;
  rfp: {
    id: string;
    name: string;
    instructions: string | null;
    dueDate: string | null;
    templateName: string;
    sourcingPartner: string | null;
    gm: string | null;
  };
  productCount: number;
  submittedCount: number;
  completion: number;
  products: {
    id: string;
    styleNumber: string;
    name: string;
    heroImage: string | null;
    state: "SUBMITTED" | "DRAFT" | "BLANK";
    fob: number | null;
  }[];
};

const STATUS_LABEL: Record<string, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  SUBMITTED: "Submitted",
  AWAITING_RESPONSE: "Awaiting response",
  AWARDED: "Awarded",
  NOT_PROCEEDING: "Not proceeding",
};

export default function VendorDashboard() {
  const { vendorId, vendorName, active } = useVendorView();
  const { data, loading, error } = useApi<Invitation[]>(
    vendorId ? `/api/vendor/${vendorId}/invitations` : null,
  );

  if (!active) {
    return (
      <>
        <div className="page-hd">
          <div className="row">
            <div className="grow">
              <h1 className="ttl">Vendor portal</h1>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-b">
            <div className="empty">
              <span className="glyph">
                <Icon name="eye_on" size="lg" />
              </span>
              <div className="ttl">Pick a vendor first</div>
              <div className="desc">
                Use Vendor View in the header to see the portal as one of your
                vendors sees it.
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="page-hd">
        <div className="row">
          <div className="grow">
            <h1 className="ttl">Your RFPs</h1>
            <p className="page-sub">
              {vendorName} · everything Quince has asked you to quote
            </p>
          </div>
        </div>
      </div>

      {error ? (
        <div className="bar bar--danger">
          <Icon name="alert_triangle" />
          <div><strong>Could not load your RFPs.</strong> {error}</div>
        </div>
      ) : null}

      {loading ? (
        <div className="card"><div className="card-b">
          <div className="sk" style={{ blockSize: 24, inlineSize: "40%" }} />
        </div></div>
      ) : null}

      {data && data.length === 0 ? (
        <div className="card">
          <div className="card-b">
            <div className="empty">
              <span className="glyph">
                <Icon name="invoice" size="lg" />
              </span>
              <div className="ttl">Nothing to quote yet</div>
              <div className="desc">
                When Quince issues an RFP to you it appears here.
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {(data ?? []).map((inv) => (
        <div className="card" key={inv.id} style={{ marginBlockEnd: "var(--space-lg)" }}>
          <div className="card-h">
            <div className="ttl">{inv.rfp.name}</div>
            <div className="sub">
              {inv.productCount} products · due{" "}
              {inv.rfp.dueDate
                ? new Date(inv.rfp.dueDate).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })
                : "—"}
              {inv.rfp.sourcingPartner ? ` · ${inv.rfp.sourcingPartner}` : ""}
            </div>
          </div>

          <div className="card-b">
            <div className="vendor-rfp-head">
              <Badge tone={inv.submittedCount === inv.productCount ? "success" : undefined}>
                {STATUS_LABEL[inv.status] ?? inv.status}
              </Badge>
              <div className="vendor-progress">
                <div className="vendor-progress-bar">
                  <span style={{ inlineSize: percent(inv.completion, 0) }} />
                </div>
                <span className="vendor-progress-label">
                  {inv.submittedCount} of {inv.productCount} submitted
                </span>
              </div>
            </div>

            {inv.rfp.instructions ? (
              <div className="bar bar--info" style={{ marginBlockEnd: "var(--space-md)" }}>
                <Icon name="info_circle" />
                <div>
                  <strong>Instructions.</strong> {inv.rfp.instructions}
                </div>
              </div>
            ) : null}

            <div className="data-grid-surface">
              <table className="data-grid">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>State</th>
                    <th className="num">Your FOB</th>
                    <th className="act">Quote</th>
                  </tr>
                </thead>
                <tbody>
                  {inv.products.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <span className="id">{p.styleNumber}</span> · {p.name}
                      </td>
                      <td>
                        {p.state === "SUBMITTED" ? (
                          <Badge tone="success">Submitted</Badge>
                        ) : p.state === "DRAFT" ? (
                          <Badge tone="warning">Draft</Badge>
                        ) : (
                          <Badge>Not started</Badge>
                        )}
                      </td>
                      <td className="num">{unitCost(p.fob)}</td>
                      <td className="act">
                        <Link
                          className="btn btn--ghost btn--sm"
                          href={`/vendor/quote/${inv.id}/${p.id}`}
                        >
                          {p.state === "BLANK" ? "Start" : "Open"}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ))}
    </>
  );
}
