import { NextRequest, NextResponse } from "next/server";
import type { Role, Session, User } from "@prisma/client";
import { z, ZodError } from "zod";
import { env } from "./env";
import { deriveClientIp, ipInputFromHeaders } from "./ip";
import { logger } from "./logger";
import { can, type Permission } from "./rbac";
import {
  CSRF_COOKIE,
  CSRF_HEADER,
  SESSION_COOKIE,
  csrfValid,
  resolveSession,
} from "./session";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiContext {
  req: NextRequest;
  ip: string;
  user: User | null;
  session: Session | null;
  params: Record<string, string>;
}

export interface AuthedContext extends ApiContext {
  user: User;
  session: Session;
}

interface Options<TBody> {
  auth?: "required" | "optional" | "none";
  permission?: Permission;
  roles?: Role[];
  csrf?: boolean; // default: true for non-GET when auth !== "none"
  bodySchema?: z.ZodType<TBody>;
  maxBodyBytes?: number;
}

const DEFAULT_MAX_BODY = 256 * 1024;

export function getClientIp(req: NextRequest): string {
  const socket =
    // NextRequest.ip is populated by the platform/proxy layer, never the client body.
    (req as unknown as { ip?: string }).ip ?? null;
  return deriveClientIp(ipInputFromHeaders(req.headers, socket));
}

/**
 * CSRF same-origin guard for mutations.
 *
 * "Same origin" means the request's `Origin` (or `Referer`) matches the origin
 * the request was actually sent to - i.e. `<scheme>://<Host header>`. A
 * cross-site attacker's page cannot make `Origin` match our Host, and cannot
 * forge the victim browser's Host header. This naturally covers every alias /
 * preview URL / custom domain the app is served from. `APP_URL` and
 * `EXTRA_ALLOWED_ORIGINS` are accepted too, for setups behind a proxy that
 * rewrites Host.
 */
function allowedOrigins(req: NextRequest): Set<string> {
  const set = new Set<string>();
  const host = req.headers.get("host");
  if (host) {
    const proto =
      req.headers.get("x-forwarded-proto") ??
      (req.nextUrl.protocol.replace(":", "") || "https");
    set.add(`${proto}://${host}`);
  }
  set.add(env.APP_URL);
  for (const o of env.EXTRA_ALLOWED_ORIGINS.split(",").map((s) => s.trim())) {
    if (o) set.add(o);
  }
  return set;
}

function sameOrigin(req: NextRequest): boolean {
  const allowed = allowedOrigins(req);
  const origin = req.headers.get("origin");
  if (origin) return allowed.has(origin);

  // No Origin header (some same-origin GETs upgraded to POST, older clients):
  // fall back to Referer.
  const referer = req.headers.get("referer");
  if (!referer) return false;
  try {
    return allowed.has(new URL(referer).origin);
  } catch {
    return false;
  }
}

export function json(data: unknown, init?: number | ResponseInit): NextResponse {
  const responseInit = typeof init === "number" ? { status: init } : init;
  return NextResponse.json(data as object, responseInit);
}

type Handler<TBody> = (
  ctx: AuthedContext & { body: TBody },
) => Promise<NextResponse> | NextResponse;

type OptionalHandler<TBody> = (
  ctx: ApiContext & { body: TBody },
) => Promise<NextResponse> | NextResponse;

/**
 * Wrap a route handler with: client-IP derivation, session resolution,
 * RBAC / permission enforcement, CSRF + same-origin checks for mutations,
 * body-size limit, schema validation, and uniform error mapping.
 */
export function defineHandler<TBody = unknown>(
  opts: Options<TBody>,
  handler: Handler<TBody>,
): (req: NextRequest, route: { params: Record<string, string> }) => Promise<NextResponse>;
export function defineHandler<TBody = unknown>(
  opts: Options<TBody> & { auth: "optional" | "none" },
  handler: OptionalHandler<TBody>,
): (req: NextRequest, route: { params: Record<string, string> }) => Promise<NextResponse>;
export function defineHandler<TBody = unknown>(
  opts: Options<TBody>,
  handler: Handler<TBody> | OptionalHandler<TBody>,
) {
  return async (
    req: NextRequest,
    route: { params: Record<string, string> } = { params: {} },
  ): Promise<NextResponse> => {
    const ip = getClientIp(req);
    const method = req.method.toUpperCase();
    const authMode = opts.auth ?? "required";
    const csrfRequired =
      opts.csrf ?? (authMode !== "none" && method !== "GET" && method !== "HEAD");

    try {
      // ---- resolve session ----
      const token = req.cookies.get(SESSION_COOKIE)?.value;
      const resolved = authMode === "none" ? null : await resolveSession(token);
      const user = resolved?.user ?? null;
      const session = resolved?.session ?? null;

      if (authMode === "required" && !user) {
        throw new ApiError(401, "UNAUTHENTICATED", "Authentication required.");
      }

      // ---- CSRF + same-origin for mutations ----
      if (csrfRequired) {
        if (!sameOrigin(req)) {
          throw new ApiError(403, "BAD_ORIGIN", "Cross-origin request rejected.");
        }
        if (
          !session ||
          !csrfValid(
            req.cookies.get(CSRF_COOKIE)?.value,
            req.headers.get(CSRF_HEADER),
            session.csrfSecret,
          )
        ) {
          throw new ApiError(403, "BAD_CSRF", "Invalid or missing CSRF token.");
        }
      }

      // ---- RBAC ----
      if (user) {
        if (opts.roles && !opts.roles.includes(user.role)) {
          throw new ApiError(403, "FORBIDDEN", "Insufficient role.");
        }
        if (opts.permission && !can(user.role, opts.permission)) {
          throw new ApiError(403, "FORBIDDEN", "Insufficient permission.");
        }
      }

      // ---- body ----
      let body = undefined as unknown as TBody;
      if (opts.bodySchema) {
        const maxBytes = opts.maxBodyBytes ?? DEFAULT_MAX_BODY;
        const raw = await req.text();
        if (Buffer.byteLength(raw, "utf8") > maxBytes) {
          throw new ApiError(413, "BODY_TOO_LARGE", "Request body too large.");
        }
        let parsed: unknown;
        try {
          parsed = raw ? JSON.parse(raw) : {};
        } catch {
          throw new ApiError(400, "BAD_JSON", "Request body is not valid JSON.");
        }
        body = opts.bodySchema.parse(parsed);
      }

      const ctx = {
        req,
        ip,
        user,
        session,
        params: route.params ?? {},
        body,
      } as AuthedContext & { body: TBody };

      return await handler(ctx as never);
    } catch (err) {
      return mapError(err, { ip, path: req.nextUrl.pathname, method });
    }
  };
}

function mapError(
  err: unknown,
  meta: { ip: string; path: string; method: string },
): NextResponse {
  if (err instanceof ApiError) {
    return json({ error: { code: err.code, message: err.message } }, err.status);
  }
  if (err instanceof ZodError) {
    return json(
      {
        error: {
          code: "VALIDATION",
          message: "Invalid request.",
          issues: err.flatten(),
        },
      },
      400,
    );
  }
  // SafetyError is thrown from src/lib/safety.ts - keep it structurally decoupled.
  if (
    err &&
    typeof err === "object" &&
    "name" in err &&
    (err as { name: string }).name === "SafetyError"
  ) {
    const e = err as unknown as {
      code: string;
      message: string;
      httpStatus?: number;
    };
    return json({ error: { code: e.code, message: e.message } }, e.httpStatus ?? 422);
  }
  logger.error("unhandled api error", {
    ...meta,
    err: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  return json(
    { error: { code: "INTERNAL", message: "Internal server error." } },
    500,
  );
}
