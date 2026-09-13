"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/ds/components";

type Dest = {
  href: string;
  label: string;
  icon: React.ComponentProps<typeof Icon>["name"];
};

// Destinations only. Identity and global actions belong to the App shell
// header, not to Navigation.
const MAIN: Dest[] = [
  { href: "/style-sets", label: "Style sets", icon: "bedding" },
  { href: "/rfps", label: "RFPs", icon: "invoice" },
  { href: "/vendors", label: "Vendors", icon: "users" },
];

const AWARD: Dest[] = [
  { href: "/award", label: "Award summary", icon: "list" },
  { href: "/insights", label: "Wave insights", icon: "chart_bar" },
];

const SETUP: Dest[] = [
  { href: "/templates", label: "Templates", icon: "table" },
  { href: "/settings", label: "Settings", icon: "settings" },
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

  return (
    <div className="shell panel-first">
      <header className="hd dark">
        <div className="control search hd-search">
          <Icon name="search" size="sm" />
          <input placeholder="Search styles, RFPs, vendors" aria-label="Search" />
        </div>
        <div className="hd-global">
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
        <div className="pn-top">
          <div className="brandmark">
            <span className="glyph">P</span>
            <span className="name">Procura</span>
          </div>
        </div>
        <NavGroup title="Sourcing" items={MAIN} pathname={pathname} />
        <NavGroup title="Award" items={AWARD} pathname={pathname} />
        <NavGroup title="Setup" items={SETUP} pathname={pathname} />
      </nav>

      <main className="ct">{children}</main>
    </div>
  );
}
