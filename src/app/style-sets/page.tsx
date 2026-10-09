"use client";

import * as React from "react";

import { Icon } from "@/ds/components";
import { useApi } from "@/lib/useApi";
import { StyleSetCard, type StyleSetSummary } from "./StyleSetCard";
import { SelectionTray } from "./SelectionTray";
import { ReviewVariationsModal } from "./ReviewVariationsModal";
import { useSelection } from "@/lib/selection";

/**
 * S1 — the style-set gallery.
 *
 * A set is its own ROUTE rather than component state, so the nav link back to
 * "Style sets" actually returns here. Drilling in as state meant clicking the
 * nav navigated to the URL it was already on, and nothing happened.
 */
export default function StyleSetsPage() {
  const sets = useApi<StyleSetSummary[]>("/api/style-sets");
  const selection = useSelection();
  const [reviewOpen, setReviewOpen] = React.useState(false);

  return (
    <>
      <div className="page-hd">
        <div className="row">
          <div className="grow">
            <h1 className="ttl">Style sets</h1>
            <p className="page-sub">
              Curated groups of styles a wave bids on. Pick a set to see its
              styles.
            </p>
          </div>
        </div>
      </div>

      {sets.error ? (
        <div className="bar bar--danger">
          <Icon name="alert_triangle" />
          <div>
            <strong>Style sets could not be loaded.</strong> {sets.error}
          </div>
        </div>
      ) : null}

      {sets.loading ? <SetGridSkeleton /> : null}

      {sets.data && sets.data.length === 0 ? (
        <div className="card">
          <div className="card-b">
            <div className="empty">
              <span className="glyph">
                <Icon name="bedding" size="lg" />
              </span>
              <div className="ttl">No style sets yet</div>
              <div className="desc">
                Style sets group the styles a wave will bid on. Run the seed
                to load them.
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="set-grid">
        {(sets.data ?? []).map((set) => (
          <StyleSetCard key={set.id} set={set} href={`/style-sets/${set.id}`} />
        ))}
      </div>

      <ReviewVariationsModal
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
      />

      <SelectionTray
        count={selection.count}
        annualSpend={selection.annualSpend}
        templateCount={selection.templateCount}
        onClear={selection.clear}
        onReviewVariations={() => setReviewOpen(true)}
      />
    </>
  );
}

function SetGridSkeleton() {
  return (
    <div className="set-grid">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div className="card raised set-card" key={i}>
          <div className="set-card-media sk" />
          <div className="card-b">
            <div className="sk" style={{ blockSize: 20, inlineSize: "60%" }} />
            <div
              className="sk"
              style={{
                blockSize: 14,
                inlineSize: "90%",
                marginBlockStart: "var(--space-sm)",
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
