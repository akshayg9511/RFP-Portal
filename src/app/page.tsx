"use client";

import * as React from "react";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Icon,
} from "@/ds/components";

type Health = {
  ok: boolean;
  database: string;
  counts?: Record<string, number>;
  hint?: string;
  error?: string;
};

// F1 landing page. It exists to prove the stack is wired — Next -> route
// handler -> Prisma -> MySQL -> Quince Core — and is replaced by the real
// dashboard later. Note it calls /api/health, never Prisma directly.
export default function Home() {
  const [health, setHealth] = React.useState<Health | null>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setFailed(true));
  }, []);

  return (
    <>
      <div className="page-hd">
        <h1>Procura</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Foundation</CardTitle>
        </CardHeader>
        <CardBody>
          <p style={{ color: "var(--color-fg-muted)" }}>
            Component F1 — scaffold, design system, database and the API
            boundary. Every screen from here reads through <code>/api/*</code>.
          </p>

          <dl className="meta-list" style={{ marginBlockStart: "var(--space-lg)" }}>
            <div>
              <dt>Design system</dt>
              <dd>
                <Badge tone="success">Quince Core v3.2</Badge>
              </dd>
            </div>
            <div>
              <dt>Database</dt>
              <dd>
                {failed ? (
                  <Badge tone="danger">Unreachable</Badge>
                ) : !health ? (
                  <Badge>Checking…</Badge>
                ) : health.ok ? (
                  <Badge tone="success">MySQL 8.4 connected</Badge>
                ) : (
                  <Badge tone="danger">{health.database}</Badge>
                )}
              </dd>
            </div>
            <div>
              <dt>Seeded rows</dt>
              <dd>
                {health?.counts
                  ? Object.entries(health.counts)
                      .map(([k, v]) => `${k} ${v}`)
                      .join(" · ")
                  : "—"}
              </dd>
            </div>
          </dl>

          {health && !health.ok && health.hint ? (
            <div className="bar bar--danger" style={{ marginBlockStart: "var(--space-lg)" }}>
              <Icon name="alert_triangle" />
              <div>
                <strong>The database is not reachable.</strong> {health.hint}
              </div>
            </div>
          ) : null}

          <p
            style={{
              color: "var(--color-fg-muted)",
              marginBlockStart: "var(--space-lg)",
            }}
          >
            Next: F2 seeds ~91 styles with real bids from the Wave 1 tracker.
          </p>
        </CardBody>
      </Card>
    </>
  );
}
