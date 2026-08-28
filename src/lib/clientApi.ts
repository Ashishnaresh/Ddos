"use client";

/** Browser-side API client. Adds the double-submit CSRF header on mutations. */
function csrfToken(): string {
  const m = document.cookie.match(/(?:^|;\s*)alt_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]!) : "";
}

export class ApiClientError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public issues?: unknown,
  ) {
    super(message);
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
