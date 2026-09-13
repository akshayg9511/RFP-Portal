"use client";

import Link from "next/link";
import { Badge, Icon } from "@/ds/components";
import { useApi } from "@/lib/useApi";
import { units } from "@/lib/format";

type RfpRow = {
  id: string;
  name: string;
  status: string;
  templateName: string;
  waveName: string;
  dueDate: string | null;
  currentRound: number;
  styleCount: number;
  vendorCount: number;
};

const STATUS_TONE: Record<string, "success" | "info" | undefined> = {
  ISSUED: "success",
  DRAFT: undefined,
  CLOSED: "info",
};

export default function RfpsPage() {
  const { data, loading, error } = useApi<RfpRow[]>("/api/rfps");

  return (
    <>
      <div className="page-hd">
        <h1>RFPs</h1>
        <div className="acts">
          <Link className="btn btn--primary" href="/style-sets">
            <Icon name="plus" />
            New RFP
          </Link>
        </div>
      </div>

      {error ? (
        <div className="bar bar--danger">
          <Icon name="alert_triangle" />
          <div>
            <strong>RFPs could not be loaded.</strong> {error}
          </div>
        </div>
      ) : null}

      <div className="data-grid-surface">
        <table className="data-grid">
          <thead>
            <tr>
              <th>RFP</th>
              <th>Status</th>
              <th>Template</th>
              <th className="num">Products</th>
              <th className="num">Vendors</th>
              <th>Round</th>
            </tr>
          </thead>
          <tbody>
            {loading
              ? [0, 1, 2, 3].map((i) => (
                  <tr key={i}>
                    {[0, 1, 2, 3, 4, 5].map((c) => (
                      <td key={c}>
                        <div className="sk" style={{ blockSize: 14 }} />
                      </td>
                    ))}
                  </tr>
                ))
              : (data ?? []).map((rfp) => (
                  <tr key={rfp.id}>
                    <td>
                      <Link href={`/rfps/${rfp.id}`}>{rfp.name}</Link>
                    </td>
                    <td>
                      <Badge tone={STATUS_TONE[rfp.status]}>{rfp.status}</Badge>
                    </td>
                    <td>{rfp.templateName}</td>
                    <td className="num">{units(rfp.styleCount)}</td>
                    <td className="num">{units(rfp.vendorCount)}</td>
                    <td>Round {rfp.currentRound}</td>
                  </tr>
                ))}
          </tbody>
        </table>

        {!loading && data && data.length === 0 ? (
          <div className="empty compact">
            <span className="glyph">
              <Icon name="invoice" size="lg" />
            </span>
            <div className="ttl">No RFPs yet</div>
            <div className="desc">
              Select products from a style set, and they become one RFP per
              quotation template.
            </div>
            <div className="acts">
              <Link className="btn btn--secondary" href="/style-sets">
                Browse style sets
              </Link>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
