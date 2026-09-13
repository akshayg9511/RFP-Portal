"use client";

import Link from "next/link";
import { Icon } from "@/ds/components";

/**
 * Placeholder for a nav destination whose screen is not built yet.
 *
 * The nav lists every destination from the start so the product's shape is
 * legible, which means links exist before screens do. A 404 reads as broken;
 * this reads as "not yet", names when it lands, and always offers a way back to
 * something real.
 */
export function NotBuiltYet({
  title,
  component,
  when,
  description,
}: {
  title: string;
  component: string;
  when: string;
  description: string;
}) {
  return (
    <>
      <div className="page-hd">
        <h1>{title}</h1>
      </div>

      <div className="card">
        <div className="card-b">
          <div className="empty">
            <span className="glyph">
              <Icon name="clock" size="lg" />
            </span>
            <div className="ttl">Not built yet — {component}</div>
            <div className="desc">
              {description} Scheduled for {when}.
            </div>
            <div className="acts">
              <Link className="btn btn--secondary" href="/">
                Back to overview
              </Link>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
