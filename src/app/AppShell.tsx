"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Icon } from "@/ds/components";
import { ProcuraMark } from "./ProcuraMark";
import { VendorSwitcher } from "./VendorSwitcher";
import { useVendorView } from "@/lib/vendorView";

type Dest = {
  href: string;
  label: string;
  icon: React.ComponentProps<typeof Icon>["name"];
};

// Destinations only. Identity and global actions belong to the App shell
// header, not to Navigation.
const MAIN: Dest[] = [
  // The catalogue comes FIRST because it is the funnel's mouth: 10,000
  // products, narrowed by revenue and attribute, grouped into style sets, then
  // sent out as RFPs. Nav order is workflow order.
  { href: "/products", label: "Style catalog", icon: "sku" },
  { href: "/style-sets", label: "Style sets", icon: "bedding" },
  { href: "/rfps", label: "RFPs", icon: "invoice" },
  { href: "/vendors", label: "Vendors", icon: "users" },
];

const AWARD: Dest[] = [
  // P11 — bids, then award, then insights: the order the work happens in.
  { href: "/bid-summary", label: "Bid summary", icon: "grid" },
  { href: "/award", label: "Award summary", icon: "list" },
  { href: "/insights", label: "Wave insights", icon: "chart_bar" },
];

/** What a vendor sees. Their portal is the same app, scoped to them. */
const VENDOR_DESTS: Dest[] = [
  // H4: the vendor never learns the RFP concept exists.
  { href: "/vendor", label: "Products to bid", icon: "invoice" },
];

const SETUP: Dest[] = [
  { href: "/templates", label: "Templates", icon: "table" },
  { href: "/settings", label: "Variation setup", icon: "settings" },
];

function NavGroup({
  title,
  items,
  pathname,
}: {
  title: string;
  items: Dest[];
  pathname: string;
}) {
  return (
    <>
      <div className="grp">{title}</div>
      {items.map((d) => {
        const on = pathname === d.href || pathname.startsWith(`${d.href}/`);
        return (
          <Link
            key={d.href}
            className={on ? "nav-item on" : "nav-item"}
            href={d.href}
            title={d.label}
            aria-current={on ? "page" : undefined}
          >
            <Icon name={d.icon} />
            <span className="lbl">{d.label}</span>
          </Link>
        );
      })}
    </>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const { active: vendorView } = useVendorView();

  /*
   * The demo gate renders WITHOUT the shell.
   *
   * The root layout wraps every route in AppShell, so a nested layout cannot
   * opt out — the login page was rendering with the full nav visible behind
   * it, which both looks wrong and shows the product's structure to someone
   * who has not signed in yet.
   *
   * Checked before the hooks below run their effects, but after every hook is
   * called: an early return above a hook changes the hook order between
   * renders and React throws.
   */
  const isGate = pathname === "/login";

  // Vendor View confines navigation to vendor routes. Without this a vendor
  // could reach the nomination screen, which lists every rival by name — and
  // on a demo that is one stray click away.
  React.useEffect(() => {
    if (vendorView && !pathname.startsWith("/vendor")) {
      router.replace("/vendor");
    }
  }, [vendorView, pathname, router]);

  if (isGate) return <>{children}</>;

  return (
    <div className={vendorView ? "shell panel-first nav-fixed vendor-view" : "shell panel-first nav-fixed"}>
      <header className="hd dark">
        <div className="control search hd-search">
          <Icon name="search" size="sm" />
          <input placeholder="Search styles, RFPs, vendors" aria-label="Search" />
        </div>
        <div className="hd-global">
          <VendorSwitcher />
          {/* Vendor View impersonation lands here in S4 — a persistent,
              unmistakable indicator of which vendor is being viewed. */}
          <button className="btn btn--ghost icon" aria-label="Notifications">
            <Icon name="bell" />
          </button>
          <button className="btn btn--ghost icon" aria-label="Help">
            <Icon name="help_circle" />
          </button>
          <span className="nav-avatar">AG</span>
        </div>
      </header>

      <nav className="pn nav dark" aria-label="Sections">
        <Link className="pn-brand" href="/">
          <span className="pn-brand-mark">
            <ProcuraMark />
          </span>
          <span className="pn-brand-word">Procura</span>
        </Link>
        {vendorView ? (
          <NavGroup title="Vendor" items={VENDOR_DESTS} pathname={pathname} />
        ) : (
          <>
            <NavGroup title="Sourcing" items={MAIN} pathname={pathname} />
            <NavGroup title="Award" items={AWARD} pathname={pathname} />
            <NavGroup title="Account" items={SETUP} pathname={pathname} />
          </>
        )}
      </nav>

      <main className="ct">{children}</main>
    </div>
  );
}
