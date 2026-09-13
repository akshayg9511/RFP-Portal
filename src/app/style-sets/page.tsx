"use client";

import * as React from "react";
import { Icon } from "@/ds/components";
import { useApi } from "@/lib/useApi";
import { useSelection } from "@/lib/selection";
import { money, units } from "@/lib/format";
import { StyleSetCard, type StyleSetSummary } from "./StyleSetCard";
import { StyleCard, type StyleSummary } from "./StyleCard";
import { StyleDetail } from "./StyleDetail";
import { SelectionTray } from "./SelectionTray";

/**
 * S1 — the style browser.
 *
 * Two levels: a gallery of style-set cards, then that set's styles as an
 * image-forward grid. Style detail opens in a drawer over the grid, the same
 * pattern the Playground uses later.
 */
export default function StyleSetsPage() {
  const [openSet, setOpenSet] = React.useState<StyleSetSummary | null>(null);
  const [openStyle, setOpenStyle] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");

  const sets = useApi<StyleSetSummary[]>("/api/style-sets");
  const styles = useApi<StyleSummary[]>(
    openSet ? `/api/styles?styleSetId=${openSet.id}` : null,
  );

  const selection = useSelection();

  const visible = React.useMemo(() => {
    const list = styles.data ?? [];
    if (!query.trim()) return list;
    const q = query.toLowerCase();
    return list.filter(
      (s) =>
        s.styleNumber.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q),
    );
  }, [styles.data, query]);

  // Walking styles in the drawer follows what is on screen, filtered included.
  const openIndex = visible.findIndex((s) => s.id === openStyle);

  function selectAllVisible() {
    if (!openSet) return;
    selection.addMany(
      visible.map((s) => ({
        id: s.id,
        styleNumber: s.styleNumber,
        name: s.name,
        // The real hierarchy, not the set name — the tray counts distinct
        // division+department to show how many RFPs the selection becomes, and
        // must agree with the split preview.
        division: s.division,
        department: s.department,
        annualSpend: s.annualSpend,
      })),
    );
  }

  return (
    <>
      <div className="page-hd">
        {openSet ? (
          <nav className="crumbs" aria-label="Breadcrumb">
            <a
              className="crumb"
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setOpenSet(null);
                setQuery("");
              }}
            >
              Style sets
            </a>
          </nav>
        ) : null}
        <div className="row">
          <div className="grow">
            <h1 className="ttl">{openSet ? openSet.name : "Style sets"}</h1>
          </div>
          {/* Below the turn the filter strip has no room for its trailing
              action, so the header carries the same one as an overflow. */}
          {openSet ? (
            <div className="ovf">
              <button
                className="btn btn--ghost icon"
                aria-haspopup="menu"
                aria-label="More actions"
                onClick={selectAllVisible}
              >
                <Icon name="more_vertical" />
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {openSet ? (
        <>
          <div className="filter-bar">
            <div className="fb-filters">
              <div className="control search sm">
                <Icon name="search" size="sm" />
                <input
                  placeholder="Search this set"
                  aria-label="Search styles in this set"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            </div>
            <div className="fb-actions">
              <button
                className="btn btn--ghost btn--sm"
                onClick={selectAllVisible}
              >
                Select all {visible.length}
              </button>
            </div>
          </div>

          {styles.loading ? <StyleGridSkeleton /> : null}

          {styles.error ? (
            <div className="bar bar--danger">
              <Icon name="alert_triangle" />
              <div>
                <strong>Those styles could not be loaded.</strong> {styles.error}
              </div>
            </div>
          ) : null}

          {!styles.loading && !styles.error && visible.length === 0 ? (
            <div className="card">
              <div className="card-b">
                <div className="empty compact">
                  <span className="glyph">
                    <Icon name="search" size="lg" />
                  </span>
                  <div className="ttl">No styles match “{query}”</div>
                  <div className="desc">Try a different style number or name.</div>
                  <div className="acts">
                    <button
                      className="btn btn--secondary"
                      onClick={() => setQuery("")}
                    >
                      Clear search
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          <div className="style-grid">
            {visible.map((style) => (
              <StyleCard
                key={style.id}
                style={style}
                selected={selection.isSelected(style.id)}
                onToggle={() =>
                  selection.toggle({
                    id: style.id,
                    styleNumber: style.styleNumber,
                    name: style.name,
                    division: style.division,
                    department: style.department,
                    annualSpend: style.annualSpend,
                  })
                }
                onOpen={() => setOpenStyle(style.id)}
              />
            ))}
          </div>
        </>
      ) : (
        <>
          {sets.loading ? <SetGridSkeleton /> : null}

          {sets.error ? (
            <div className="bar bar--danger">
              <Icon name="alert_triangle" />
              <div>
                <strong>Style sets could not be loaded.</strong> {sets.error}
              </div>
            </div>
          ) : null}

          {sets.data && sets.data.length === 0 ? (
            <div className="card">
              <div className="card-b">
                <div className="empty">
                  <span className="glyph">
                    <Icon name="bedding" size="lg" />
                  </span>
                  <div className="ttl">No style sets yet</div>
                  <div className="desc">
                    Style sets group the products a wave will bid on. Run the
                    seed to load them.
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          <div className="set-grid">
            {(sets.data ?? []).map((set) => (
              <StyleSetCard key={set.id} set={set} onOpen={() => setOpenSet(set)} />
            ))}
          </div>
        </>
      )}

      <StyleDetail
        styleId={openStyle}
        onClose={() => setOpenStyle(null)}
        onPrev={
          openIndex > 0 ? () => setOpenStyle(visible[openIndex - 1].id) : undefined
        }
        onNext={
          openIndex >= 0 && openIndex < visible.length - 1
            ? () => setOpenStyle(visible[openIndex + 1].id)
            : undefined
        }
      />

      <SelectionTray
        count={selection.count}
        annualSpend={selection.annualSpend}
        templateCount={selection.templateCount}
        onClear={selection.clear}
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

function StyleGridSkeleton() {
  return (
    <div className="style-grid">
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <div className="card raised style-card" key={i}>
          <div className="style-card-media sk" />
          <div className="card-b">
            <div className="sk" style={{ blockSize: 12, inlineSize: "40%" }} />
            <div
              className="sk"
              style={{
                blockSize: 16,
                inlineSize: "85%",
                marginBlockStart: "var(--space-xs)",
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
