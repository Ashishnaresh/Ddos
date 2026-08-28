import type { NextResponse } from "next/server";
import { env } from "./env";
import { CSRF_COOKIE, SESSION_COOKIE } from "./constants";

const isSecure = () => env.NODE_ENV === "production";

export function setSessionCookies(
  res: NextResponse,
  opts: { token: string; csrfSecret: string; expiresAt: Date },
): NextResponse {
  res.cookies.set(SESSION_COOKIE, opts.token, {
    httpOnly: true,
    secure: isSecure(),
    sameSite: "lax",
    path: "/",
    expires: opts.expiresAt,
  });
  // Readable by the frontend so it can echo it back in the CSRF header
  // (double-submit-cookie pattern). Not httpOnly by design.
  res.cookies.set(CSRF_COOKIE, opts.csrfSecret, {
    httpOnly: false,
    secure: isSecure(),
    sameSite: "lax",
    path: "/",
    expires: opts.expiresAt,
  });
  return res;
}

export function clearSessionCookies(res: NextResponse): NextResponse {
  for (const name of [SESSION_COOKIE, CSRF_COOKIE]) {
    res.cookies.set(name, "", {
      httpOnly: name === SESSION_COOKIE,
      secure: isSecure(),
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
  }
  return res;
}
