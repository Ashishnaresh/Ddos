import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/constants";

/**
 * Lightweight UX guard only. It checks that a session cookie is *present* and
 * redirects to /login otherwise. Real authentication + authorization always
 * happens server-side in each route handler / server component - never trust
 * this layer for security decisions.
 */
const PUBLIC_PATHS = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasSession = Boolean(req.cookies.get(SESSION_COOKIE)?.value);

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    // Bounce an already-authenticated user away from sign-in / sign-up only.
    // A logged-in user may still legitimately open a password-reset link.
    const bounceWhenAuthed = pathname === "/login" || pathname === "/register";
    if (hasSession && bounceWhenAuthed) {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }
    return NextResponse.next();
  }

  if (!hasSession) {
    const url = new URL("/login", req.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/targets/:path*",
    "/tests/:path*",
    "/audit/:path*",
    "/admin/:path*",
    "/settings/:path*",
    "/login",
    "/register",
    "/forgot-password",
    "/reset-password",
  ],
};
