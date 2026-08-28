"use client";

/** Browser-side API client. Adds the double-submit CSRF header on mutations. */
function csrfToken(): string {
  const m = document.cookie.match(/(?:^|;\s*)alt_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]!) : "";
}

interface FlattenedIssues {
  formErrors?: string[];
  fieldErrors?: Record<string, string[]>;
}

export class ApiClientError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public issues?: unknown,
  ) {
    // If the server sent Zod field errors, surface the specific reasons instead
    // of the generic "Invalid request."
    const flat = issues as FlattenedIssues | undefined;
    const parts: string[] = [];
    if (flat?.fieldErrors) {
      for (const [field, msgs] of Object.entries(flat.fieldErrors)) {
        for (const m of msgs ?? []) parts.push(`${field}: ${m}`);
      }
    }
    for (const m of flat?.formErrors ?? []) parts.push(m);
    super(parts.length > 0 ? parts.join(" · ") : message);
  }
}

export async function api<T = unknown>(
  path: string,
  options: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const method = (options.method ?? (options.json ? "POST" : "GET")).toUpperCase();
  const headers = new Headers(options.headers);
  if (method !== "GET" && method !== "HEAD") {
    headers.set("x-csrf-token", csrfToken());
    if (options.json !== undefined) headers.set("content-type", "application/json");
  }
  const res = await fetch(path, {
    ...options,
    method,
    headers,
    credentials: "same-origin",
    body: options.json !== undefined ? JSON.stringify(options.json) : options.body,
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = data?.error ?? {};
    throw new ApiClientError(
      res.status,
      err.code ?? "ERROR",
      err.message ?? `Request failed (${res.status})`,
      err.issues,
    );
  }
  return data as T;
}
