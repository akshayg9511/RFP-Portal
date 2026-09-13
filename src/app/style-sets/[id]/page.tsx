"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Icon } from "@/ds/components";
import { useApi } from "@/lib/useApi";
import { useSelection } from "@/lib/selection";
import { money } from "@/lib/format";
import { StyleCard, type StyleSummary } from "../StyleCard";
import { StyleDetail } from "../StyleDetail";
import { SelectionTray } from "../SelectionTray";

type SetDetail = {
  id: string;
  name: string;
  description: string | null;
  styleCount: number;
  annualSpend: number;
};

/**
 * The styles inside one set. Its own route, so the nav link back to
 * "Style sets" works and a set is linkable.
 */
export default function StyleSetPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const set = useApi<SetDetail>(`/api/style-sets/${id}`);
  const styles = useApi<StyleSummary[]>(`/api/styles?styleSetId=${id}`);
  const selection = useSelection();

  const [query, setQuery] = React.useState("");
  const [openStyle, setOpenStyle] = React.useState<string | null>(null);

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

  const openIndex = visible.findIndex((s) => s.id === openStyle);

  function selectAllVisible() {
    selection.addMany(
      visible.map((s) => ({
        id: s.id,
        styleNumber: s.styleNumber,
        name: s.name,
        // The real hierarchy, not the set name — the tray counts distinct
        // division+department to say how many RFPs this becomes, and must
        // agree with the split preview.
        division: s.division,
        department: s.department,
        annualSpend: s.annualSpend,
      })),
    );
  }

  const allSelected =
    visible.length > 0 && visible.every((s) => selection.isSelected(s.id));

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
            <h1 className="ttl">{set.data?.name ?? "…"}</h1>
            {set.data ? (
              <p className="page-sub">
                {set.data.styleCount} styles · {money(set.data.annualSpend)}{" "}
                annual spend
              </p>
            ) : null}
          </div>
          {/* Below the turn the filter strip has no room for its trailing
              action, so the header carries the same one. */}
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
        </div>
      </div>

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
          <button className="btn btn--ghost btn--sm" onClick={selectAllVisible}>
            {allSelected ? "Deselect all" : `Select all ${visible.length}`}
          </button>
        </div>
      </div>

      {styles.error ? (
        <div className="bar bar--danger">
          <Icon name="alert_triangle" />
          <div>
            <strong>Those styles could not be loaded.</strong> {styles.error}
          </div>
        </div>
      ) : null}

      {styles.loading ? <StyleGridSkeleton /> : null}

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
