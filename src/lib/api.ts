import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";

/**
 * Shared helpers for route handlers.
 *
 * This API surface IS the contract Spring Boot reimplements at V1, so the
 * shapes here are deliberate: plain JSON, numbers as numbers, no Prisma types
 * leaking to the client.
 */

/**
 * Prisma returns Decimal for money columns. Left alone it serialises as a
 * string and every arithmetic on the client silently concatenates.
 */
export function num(value: Prisma.Decimal | number | null): number | null {
  if (value === null || value === undefined) return null;
  return typeof value === "number" ? value : Number(value);
}

/** Same, but for a column that should never be null downstream. */
export function numOr(
  value: Prisma.Decimal | number | null,
  fallback = 0,
): number {
  return num(value) ?? fallback;
}

export function ok<T>(data: T) {
  return NextResponse.json(data);
}

export function notFound(what: string) {
  return NextResponse.json(
    { error: "not_found", message: `${what} not found` },
    { status: 404 },
  );
}

export function badRequest(message: string) {
  return NextResponse.json({ error: "bad_request", message }, { status: 400 });
}

/**
 * Wraps a handler so an unexpected failure returns JSON rather than an HTML
 * error page — a screen fetching this should be able to show a real message.
 */
export function handle<T>(fn: () => Promise<T | Response>) {
  return fn()
    .then((result) =>
      // A handler that has already built a Response — notFound(), badRequest()
      // — means it. Passing it through ok() would JSON-encode the Response
      // OBJECT and send it with status 200, so every guard in every route
      // silently became an empty 200 body. Found when a 99% award, which must
      // be refused, returned {} instead of a 400.
      result instanceof Response ? result : ok(result),
    )
    .catch(serverError);
}

function serverError(error: unknown) {
  console.error("[api]", error);
  return NextResponse.json(
    {
      error: "server_error",
      message: error instanceof Error ? error.message : String(error),
    },
    { status: 500 },
  );
}

/**
 * Vendor type is DERIVED, never stored (Build Doc 3.7). One boolean plus the
 * current-supplier relation gives all three labels — which is why the Wave 1
 * data errors, where one vendor carried three conflicting types, cannot occur
 * here. Nobody types a type.
 */
export type VendorType = "INCUMBENT" | "EXISTING" | "NEW";

export function vendorType(
  isNewToQuince: boolean,
  isCurrentSupplierOfStyle: boolean,
): VendorType {
  if (isNewToQuince) return "NEW";
  return isCurrentSupplierOfStyle ? "INCUMBENT" : "EXISTING";
}
