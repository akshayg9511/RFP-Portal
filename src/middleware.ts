import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * ONE SHARED PASSWORD IN FRONT OF THE WHOLE PORTAL.
 *
 * The prototype has no auth by design (Build Doc §6.1 — Okta at V1), which is
 * fine on localhost and NOT fine behind a public tunnel: every screen shows
 * vendor names, bid prices and the internal clean-sheet cost model, and 13
 * write endpoints are open, including `rfps/[id]/issue` and
 * `styles/[id]/award` — the two that notify vendors in a real system.
 *
 * This is a demo gate, deliberately the smallest thing that works:
 * - ONE password for everyone, from DEMO_PASSWORD. No accounts, no database.
 * - The cookie stores a SHA-256 of the password plus a server-side secret, so
 *   the cookie cannot be forged without knowing both, and the password itself
 *   is never stored in the browser.
 * - Comparison is length-safe: a plain `===` on secrets leaks length through
 *   timing, and while that is academic for a demo it costs nothing to avoid.
 *
 * It is NOT a substitute for real auth. It stops a forwarded link being
 * world-readable; it does not give you per-user identity or an audit trail.
 */

const COOKIE = "procura_demo";

/**
 * Paths that must answer BEFORE the gate.
 *
 * `/api/login` is the one that matters and the one I first left out: the
 * gate was blocking the very endpoint used to get through it, so a correct
 * password returned the middleware's own 401 and looked like a wrong
 * password. Caught because the 401 body said "This demo is password
 * protected" rather than the login route's "That password is not right" —
 * the two messages differ precisely so this is diagnosable.
 */
const OPEN = ["/login", "/api/login", "/api/health"];

/** Constant-time-ish compare. Both sides are hex digests of equal length. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Web Crypto — middleware runs on the edge runtime, so no node:crypto. */
export async function tokenFor(password: string, secret: string) {
  const data = new TextEncoder().encode(`${password}:${secret}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function middleware(request: NextRequest) {
  const password = process.env.DEMO_PASSWORD;

  // No password configured = no gate. Keeps `npm run dev` on localhost exactly
  // as it was; the gate only exists when you deliberately set the variable.
  if (!password) return NextResponse.next();

  const { pathname } = request.nextUrl;
  if (OPEN.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  const secret = process.env.DEMO_SECRET ?? "procura-demo-secret";
  const expected = await tokenFor(password, secret);
  const got = request.cookies.get(COOKIE)?.value ?? "";

  if (safeEqual(got, expected)) return NextResponse.next();

  /* An API call gets 401 rather than an HTML redirect — a fetch following a
     redirect to a login page would parse the page as JSON and fail with a
     confusing error instead of an honest "not signed in". */
  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "unauthorized", message: "This demo is password protected." },
      { status: 401 },
    );
  }

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  // Come back to where they were aiming once they are through the gate.
  url.searchParams.set("next", pathname + request.nextUrl.search);
  return NextResponse.redirect(url);
}

export const config = {
  /*
   * Everything except STATIC ASSETS.
   *
   * `/ds/` is the load-bearing one and the one I first missed: the design
   * system's stylesheets are served from `public/`, so the gate redirected
   * them to /login and the browser received HTML where CSS should be. The
   * whole portal rendered unstyled and the console showed
   * "Unexpected token '<'" — a stylesheet parsed as markup.
   *
   * Gating an asset buys nothing anyway: the CSS and the fonts are the design
   * system, not Quince data.
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|ds/|fonts/|.*\\.(?:css|js|map|woff2?|ttf|png|jpg|jpeg|svg|ico|webp)$).*)",
  ],
};
