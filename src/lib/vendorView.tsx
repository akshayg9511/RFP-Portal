"use client";

import * as React from "react";

/**
 * Vendor View — impersonation.
 *
 * There is ONE portal. The vendor surface is not a separate application: a
 * procurement user switches into Vendor View and sees exactly what that vendor
 * sees.
 *
 * The architectural rule (Build Doc §6.1): the only difference between
 * impersonation and real vendor access is HOW VENDOR IDENTITY RESOLVES. Every
 * vendor screen reads `vendorId` from here and nothing else, so in V1 this hook
 * resolves from the session instead and not one screen changes.
 */

type VendorViewState = {
  vendorId: string | null;
  vendorName: string | null;
  active: boolean;
  enter: (vendorId: string, vendorName: string) => void;
  exit: () => void;
};

const Context = React.createContext<VendorViewState | null>(null);
const STORAGE_KEY = "procura.vendorView";

export function VendorViewProvider({ children }: { children: React.ReactNode }) {
  const [vendor, setVendor] = React.useState<{ id: string; name: string } | null>(
    null,
  );

  // Restored after mount, never during render — the server has no
  // sessionStorage and hydration would mismatch.
  React.useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) setVendor(JSON.parse(raw));
    } catch {
      // Blocked storage is not an error worth surfacing.
    }
  }, []);

  const value = React.useMemo<VendorViewState>(
    () => ({
      vendorId: vendor?.id ?? null,
      vendorName: vendor?.name ?? null,
      active: vendor !== null,
      enter: (id, name) => {
        const next = { id, name };
        setVendor(next);
        try {
          sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          // Impersonation still works for this tab.
        }
      },
      exit: () => {
        setVendor(null);
        try {
          sessionStorage.removeItem(STORAGE_KEY);
        } catch {
          // Nothing to clean up.
        }
      },
    }),
    [vendor],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useVendorView(): VendorViewState {
  const context = React.useContext(Context);
  if (!context) {
    throw new Error("useVendorView must be used inside VendorViewProvider");
  }
  return context;
}
