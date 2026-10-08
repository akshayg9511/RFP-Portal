"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Icon } from "@/ds/components";
import { useApi } from "@/lib/useApi";
import { useSelection } from "@/lib/selection";
import { money } from "@/lib/format";
import { StyleCard, type StyleSummary } from "../StyleCard";
import { FilterBar } from "@/components/FilterBar";
import { facetsOf } from "@/components/FacetSelect";
import { StyleDetail } from "../StyleDetail";
import { SelectionTray } from "../SelectionTray";
import { ReviewVariationsModal } from "../ReviewVariationsModal";

type SetDetail = {
  id: string;
  name: string;
  description: string | null;
  styleCount: number;
  annualSpend: number;
  /**
   * The set's own membership, which carries memberVariationIds. Read from
   * here rather than /api/styles because only this route knows WHICH
   * variations the set admits — /api/styles answers "is this style in any
   * set", not "which of its sizes".
   */
  styles?: (StyleSummary & {
    memberVariationIds?: string[];
    variations?: { id: string; label: string }[];
  })[];
};

/**
 * The styles inside one set. Its own route, so the nav link back to
 * "Style sets" works and a set is linkable.
 */
export default function StyleSetPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const set = useApi<SetDetail>(`/api/style-sets/${id}`);
  // /api/styles now returns { styles, facets, total } — the catalogue screen
  // needs facet counts, and one shape for both consumers beats two endpoints.
  const styles = useApi<{ styles: StyleSummary[] }>(
    `/api/styles?styleSetId=${id}`,
  );
  const selection = useSelection();
  const [reviewOpen, setReviewOpen] = React.useState(false);

  const [query, setQuery] = React.useState("");
  // A filter here too (Aravind, C8), on what a set varies by.
  const [more, setMore] = React.useState<{ subDepartment: string[]; material: string[] }>({
    subDepartment: [],
    material: [],
  });
  const [openStyle, setOpenStyle] = React.useState<string | null>(null);

  const visible = React.useMemo(() => {
    // Membership comes from the set route; the catalog route supplies the
    // fuller row (facets, counts). Merge rather than choose, so neither
    // screen loses a field it already renders.
    const fromSet = new Map((set.data?.styles ?? []).map((s) => [s.id, s]));
    const list = (styles.data?.styles ?? []).map((s) => ({
      ...s,
      memberVariationIds: fromSet.get(s.id)?.memberVariationIds ?? [],
      variations: fromSet.get(s.id)?.variations ?? [],
    }));
    const q = query.trim().toLowerCase();
    return list.filter(
      (s) =>
        (!q || s.styleNumber.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)) &&
        (!more.subDepartment.length || more.subDepartment.includes(s.subDepartment)) &&
        (!more.material.length || more.material.includes(s.material ?? "")),
    );
  }, [styles.data, set.data, query, more]);

  const facetOf = (key: "subDepartment" | "material") =>
    facetsOf(styles.data?.styles ?? [], (s) => s[key]);

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

      {/* One row, held at the top while the cards scroll (Open Questions
          02): search, the set's figures, Select all and a filter (C8). */}
      <div className="ss-toolbar">
        <FilterBar
          search={{ value: query, onChange: setQuery, placeholder: "Search this set" }}
          groups={[
            { key: "subDepartment", label: "Sub-department", options: facetOf("subDepartment"), selected: more.subDepartment },
            { key: "material", label: "Material", options: facetOf("material"), selected: more.material },
          ]}
          onGroupsChange={(next) =>
            setMore({ subDepartment: next.subDepartment ?? [], material: next.material ?? [] })
          }
        />
        <span className="ss-meta">
          {visible.length} of {set.data?.styleCount ?? visible.length} styles
        </span>
        <button className="btn btn--ghost sm" onClick={selectAllVisible}>
          {allSelected ? "Deselect all" : `Select all ${visible.length}`}
        </button>
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
            variations={style.variations}
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
