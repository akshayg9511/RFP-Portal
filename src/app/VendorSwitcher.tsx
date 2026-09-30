"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/ds/components";
import { useApi } from "@/lib/useApi";
import { useVendorView } from "@/lib/vendorView";

type VendorOption = {
  id: string;
  name: string;
  vendorCode: string;
  cooRegion: string | null;
  isTemp: boolean;
};

/**
 * The Vendor View control.
 *
 * Picks any vendor from the master and switches the portal into their view.
 * While active the indicator is deliberately loud — a persistent, unmistakable
 * marker of whose eyes you are looking through, because the screens themselves
 * are identical to what that vendor really sees.
 */
export function VendorSwitcher() {
  const router = useRouter();
  const { vendorId, vendorName, active, enter, exit } = useVendorView();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const wrap = React.useRef<HTMLDivElement>(null);

  const { data } = useApi<VendorOption[]>(open ? "/api/vendors" : null);

  React.useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrap.current && !wrap.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const vendors = (data ?? []).filter((v) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      v.name.toLowerCase().includes(q) || v.vendorCode.toLowerCase().includes(q)
    );
  });

  if (active) {
    return (
      <div className="vv-active">
        <Icon name="eye_on" size="sm" />
        <span className="vv-active-label">
          Viewing as <strong>{vendorName}</strong>
        </span>
        <button
          className="btn btn--sm vv-exit"
          onClick={() => {
            exit();
            router.push("/style-sets");
          }}
        >
          Exit
        </button>
      </div>
    );
  }

  return (
    <div className="vv-wrap" ref={wrap}>
      <button
        className="btn btn--ghost btn--sm"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="eye_on" size="sm" />
        Vendor View
      </button>

      {open ? (
        <div className="vv-menu" role="menu">
          <div className="vv-menu-head">
            <div className="control search sm">
              <Icon name="search" size="sm" />
              <input
                autoFocus
                placeholder="Find a vendor"
                aria-label="Find a vendor"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>

          <div className="vv-menu-list">
            {vendors.length === 0 ? (
              <p className="vv-menu-empty">No vendor matches “{query}”.</p>
            ) : null}

            {vendors.slice(0, 40).map((v) => (
              <button
                key={v.id}
                className="menu-item"
                role="menuitem"
                onClick={() => {
                  enter(v.id, v.name);
                  setOpen(false);
                  router.push("/vendor");
                }}
              >
                <span className="vv-menu-name">{v.name}</span>
                <span className="vv-menu-meta">
                  {v.vendorCode}
                  {/* The code already says TEMP-, so this said it twice. */}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Exported so the shell can key the whole page off the impersonation state. */
export function useIsVendorView() {
  return useVendorView().active;
}
