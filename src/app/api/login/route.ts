import { NextResponse } from "next/server";
import { tokenFor } from "@/middleware";

/**
 * Exchange the shared demo password for the gate cookie.
 *
 * Deliberately thin: no accounts, no session store. The cookie is a digest of
 * the password plus a server-side secret, so it cannot be forged without both,
 * and the password never lands in the browser.
 */
export async function POST(request: Request) {
  const password = process.env.DEMO_PASSWORD;
  if (!password) {
    // No gate configured — nothing to sign in to.
    return NextResponse.json({ ok: true });
  }

  const body = (await request.json().catch(() => ({}))) as {
    password?: string;
  };

  if (body.password !== password) {
    /* A short delay blunts trivial scripted guessing. Not a rate limiter —
       for a demo gate behind a private link, the honest answer is that this
       is a speed bump, not a lock. */
    await new Promise((r) => setTimeout(r, 400));
    return NextResponse.json(
      { error: "bad_password", message: "That password is not right." },
      { status: 401 },
    );
  }

  const secret = process.env.DEMO_SECRET ?? "procura-demo-secret";
  const response = NextResponse.json({ ok: true });

  response.cookies.set("procura_demo", await tokenFor(password, secret), {
    httpOnly: true,
    sameSite: "lax",
    // The tunnel is https; on plain localhost this would prevent the cookie
    // being set at all, so it follows the request rather than being hardcoded.
    secure: new URL(request.url).protocol === "https:",
    path: "/",
    maxAge: 60 * 60 * 12, // a working day
  });

  return response;
}
