"use client";

import Link from "next/link";
import * as React from "react";
import { Badge, Checkbox, Icon } from "@/ds/components";
import { TemplateDownloadDialog, TemplateUploadDialog } from "@/components/TemplateFiles";
import { useApi } from "@/lib/useApi";
import { useVendorView } from "@/lib/vendorView";
import { unitCost } from "@/lib/format";
import {
  cueOf,
  vendorCanEdit,
  vendorLabel,
  type BidStatus,
} from "@/domain/bidStatus";

/**
 * S4 — the vendor dashboard.
 *
 * Reads vendorId from the Vendor View context and nothing else, so in V1 the
 * identity resolves from the session instead and this screen is unchanged.
 */

type Invitation = {
  id: string;
  status: string;
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
  awardedCount: number;
  decidedCount: number;
  products: {
    id: string;
    styleNumber: string;
    name: string;
    heroImage: string | null;
    state: "SUBMITTED" | "DRAFT" | "BLANK";
    fob: number | null;
    /** null while procurement has not released a decision. */
    outcome: "AWARDED" | "NOT_PROCEEDING" | null;
    awardPct: number | null;
    awardedUnits: number | null;
    /** Per vendor x product — the ladder position. See domain/bidStatus. */
    bidStatus: BidStatus;
    statusNote: string | null;
    variations: { id: string; label: string }[];
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

  /* The flattening. One row per product the vendor was invited on, with the
     invitation id carried along so the quote route still resolves — only the
     LANDING page loses the RFP, not the data model. */
  const flat = (data ?? []).flatMap((inv) =>
    inv.products.map((p) => ({
      ...p,
      invitationId: inv.id,
      dueDate: inv.rfp.dueDate,
      templateName: inv.rfp.templateName,
    })),
  );

  // ux/15 — pick rows to download their Excel templates together.
  const [picked, setPicked] = React.useState<Set<string>>(() => new Set());
  const [dialog, setDialog] = React.useState<"download" | "upload" | null>(null);
  const keyOf = (r: { invitationId: string; id: string }) => `${r.invitationId}-${r.id}`;
  const chosen = flat.filter((r) => picked.has(keyOf(r)));
  const forDownload = (chosen.length ? chosen : flat).map((r) => ({
    styleNumber: r.styleNumber,
    name: r.name,
    templateName: r.templateName,
    rows: r.variations.length || 1,
  }));

  /* Instructions, deduped. Two RFPs can legitimately carry the same wording,
     and the vendor should read it once. */
  const instructions = Array.from(
    new Set(
      (data ?? [])
        .map((inv) => inv.rfp.instructions?.trim())
        .filter((t): t is string => Boolean(t)),
    ),
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
            <h1 className="ttl">Products to bid</h1>
            <p className="page-sub">
              {vendorName} · everything Quince has asked you to quote
            </p>
          </div>
          {flat.length ? (
            <div className="acts">
              <button type="button" className="btn btn--secondary" onClick={() => setDialog("upload")}>
                <Icon name="upload" size="sm" />
                Upload quotations
              </button>
              <button type="button" className="btn btn--secondary" onClick={() => setDialog("download")}>
                <Icon name="download" size="sm" />
                {chosen.length ? `Download templates (${chosen.length})` : "Download all templates"}
              </button>
            </div>
          ) : null}
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
                When Quince asks you to quote a product it appears here.
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* ONE FLAT PRODUCT LIST — no RFP grouping, no RFP names.
          
          Akshay, 2 Oct: "I also feel vendor don't need an RFP screen. They
          just need to have a bid page… RFP, as a concept, is only for
          Quince." So the vendor never learns the concept exists; the RFP's
          instruction travels with the product as guidance instead. */}
      {/* The table IS the surface — no card around it (Aravind, C55) —
          and the RFP's instruction leads, as a message bar. The vendor sees
          WHAT to follow, never which RFP it came from. */}
      {flat.length && instructions.length ? (
        <div className="bar bar--info vd-instructions">
          <Icon name="info_circle" />
          <div>
            <strong>Instructions.</strong> {instructions.join(" ")}
          </div>
        </div>
      ) : null}

      {flat.length ? (
            <div className="data-grid-surface">
              <table className="data-grid">
                <colgroup>
                  <col style={{ width: "44px" }} />
                  <col style={{ width: "34%" }} />
                  <col style={{ width: "26%" }} />
                  <col style={{ width: "12%" }} />
                  <col style={{ width: "12%" }} />
                  <col style={{ width: "16%" }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>
                      <Checkbox
                        aria-label="Select all products"
                        checked={flat.length > 0 && picked.size === flat.length}
                        mixed={picked.size > 0 && picked.size < flat.length}
                        onChange={() =>
                          setPicked(picked.size === flat.length ? new Set() : new Set(flat.map(keyOf)))
                        }
                      />
                    </th>
                    <th>Product</th>
                    {/* The ladder position, in the VENDOR's words. */}
                    <th>Status</th>
                    <th className="num">Your FOB</th>
                    <th>Due</th>
                    <th className="act">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {flat.map((row) => {
                    const cue = cueOf(row.bidStatus);
                    return (
                      <tr key={`${row.invitationId}-${row.id}`}>
                        <td>
                          <Checkbox
                            aria-label={`Select ${row.name}`}
                            checked={picked.has(keyOf(row))}
                            onChange={() =>
                              setPicked((prev) => {
                                const next = new Set(prev);
                                const k = keyOf(row);
                                if (next.has(k)) next.delete(k);
                                else next.add(k);
                                return next;
                              })
                            }
                          />
                        </td>
                        <td>
                          <span className="id">{row.styleNumber}</span>{" "}
                          {row.name}
                          {row.variations.length ? (
                            <span className="vb-vars">
                              {row.variations.length} variant
                              {row.variations.length === 1 ? "" : "s"} to quote
                            </span>
                          ) : null}
                        </td>
                        <td>
                          {/* `act` is the vendor's cue to do something, so it
                              carries the only emphasis on the row. A waiting
                              state is deliberately quiet — it needs nothing
                              from them. */}
                          <Badge
                            tone={
                              cue === "act"
                                ? "warning"
                                : row.bidStatus === "BID_ACCEPTED"
                                  ? "success"
                                  : undefined
                            }
                          >
                            {vendorLabel(row.bidStatus)}
                          </Badge>
                          {row.statusNote ? (
                            <span className="vb-note">{row.statusNote}</span>
                          ) : null}
                        </td>
                        <td className="num">{unitCost(row.fob)}</td>
                        <td>
                          {row.dueDate
                            ? new Date(row.dueDate).toLocaleDateString("en-GB", {
                                day: "numeric",
                                month: "short",
                              })
                            : "—"}
                        </td>
                        <td className="act">
                          {/* A row action is chrome for ITS row, so it stays a
                              ghost however many rows there are — the secondary
                              is the page's runner-up, and four of them compete.
                              The LABEL carries the difference instead: Quote /
                              Continue when they owe us something, View when
                              the bid is with Quince. */}
                          <Link
                            className="btn btn--ghost sm"
                            href={`/vendor/quote/${row.invitationId}/${row.id}`}
                          >
                            {vendorCanEdit(row.bidStatus)
                              ? row.state === "BLANK"
                                ? "Quote"
                                : "Continue"
                              : "View"}
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
      ) : null}

      {dialog === "download" ? (
        <TemplateDownloadDialog items={forDownload} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === "upload" ? <TemplateUploadDialog onClose={() => setDialog(null)} /> : null}
    </>
  );
}
