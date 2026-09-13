import type { Metadata } from "next";
import Script from "next/script";
import { AppShell } from "./AppShell";
import "./globals.css";

export const metadata: Metadata = {
  title: "Procura",
  description: "RFP and bidding platform for Quince sourcing & procurement",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // data-brand="default" data-mode="light" — the Quince Core reference theme.
    // Both are one attribute to change; nothing in a correct screen hard-codes
    // what they control.
    <html lang="en" data-brand="default" data-mode="light">
      <head>
        {/* Load order is fixed: fonts -> foundation -> brand -> components ->
            components-extra. Served from /public so the relative font URLs
            inside fonts.css resolve. */}
        <link rel="stylesheet" href="/ds/fonts.css" />
        <link rel="stylesheet" href="/ds/foundation.css" />
        <link rel="stylesheet" href="/ds/brands/default.css" />
        <link rel="stylesheet" href="/ds/components.css" />
        <link rel="stylesheet" href="/ds/components-extra.css" />
        {/* Inter is not bundled with the system; 300/400/500/600 are the
            sanctioned weights (600 is the page title and nothing else). */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap"
        />
      </head>
      <body>
        {/* window.QICONS — the 180-glyph runtime set the Icon binding reads.
            beforeInteractive so the registry exists before hydration. */}
        <Script src="/ds/icons/icons.js" strategy="beforeInteractive" />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
