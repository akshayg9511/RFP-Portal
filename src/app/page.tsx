import { redirect } from "next/navigation";

/**
 * No Home page (decision D6, 8 Oct): the app opens on Bid summary, where a
 * sourcing user spends their day once bids are in. The old system-health
 * screen lives on at /system for diagnostics, out of the nav.
 */
export default function Home() {
  redirect("/bid-summary");
}
