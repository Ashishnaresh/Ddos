import { env, trustedProxyCidrs } from "./env";

/**
 * Server-side client IP derivation.
 *
 * SECURITY: The client can put anything in X-Forwarded-For / X-Real-IP.
 * We only consult forwarding headers to the extent the *deployment operator*
 * has declared trusted proxies via TRUSTED_PROXY_MODE / TRUSTED_PROXIES.
 * The value returned here is what gets written to the immutable audit trail.
 *
 *  - none   : ignore every forwarding header, use the direct socket peer.
 *  - single : exactly one trusted hop; take the LAST XFF entry (the one the
 *             trusted proxy appended) - a client cannot forge that position.
 *  - list   : walk XFF right-to-left, discarding addresses that are inside a
 *             configured trusted CIDR; the first untrusted address is the client.
 *  - vercel : trust the platform. Vercel overwrites `x-real-ip` (and the FIRST
 *             `x-forwarded-for` entry) with the true client address on every
 *             request; a client cannot influence it. Use only on Vercel.
 */
export interface RequestIpInput {
  socketRemoteAddr: string | null;
  xForwardedFor: string | null;
  xRealIp: string | null;
}

export function deriveClientIp(input: RequestIpInput): string {
  const direct = normalize(input.socketRemoteAddr) ?? "unknown";

  if (env.TRUSTED_PROXY_MODE === "none") {
    return direct;
  }

  const chain = (input.xForwardedFor ?? "")
    .split(",")
    .map((s) => normalize(s.trim()))
    .filter((s): s is string => Boolean(s));

  if (env.TRUSTED_PROXY_MODE === "vercel") {
    // Vercel sets x-real-ip to the real client; first XFF entry is the fallback.
    return normalize(input.xRealIp) ?? chain[0] ?? direct;
  }

  if (env.TRUSTED_PROXY_MODE === "single") {
    return chain.length > 0 ? chain[chain.length - 1]! : direct;
  }

  // mode === "list"
  const candidates = [...chain, direct];
  for (let i = candidates.length - 1; i >= 0; i--) {
    const addr = candidates[i]!;
    if (!isTrustedProxy(addr)) return addr;
  }
  return direct;
}

function normalize(addr: string | null | undefined): string | null {
  if (!addr) return null;
  let a = addr.trim();
  if (!a) return null;
  // Strip IPv6-mapped IPv4 prefix and any port suffix on bare IPv4.
  if (a.startsWith("::ffff:")) a = a.slice(7);
  if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(a)) a = a.split(":")[0]!;
  return a;
}

function isTrustedProxy(addr: string): boolean {
  return trustedProxyCidrs().some((cidr) => cidrContains(cidr, addr));
}

/** Minimal IPv4 CIDR containment check. IPv6 CIDRs are treated as exact match. */
function cidrContains(cidr: string, addr: string): boolean {
  const [range, bitsStr] = cidr.split("/");
  if (!range) return false;
  if (!range.includes(".")) return range === addr; // IPv6: exact match only
  const bits = bitsStr ? Number(bitsStr) : 32;
  const toInt = (ip: string) =>
    ip.split(".").reduce((acc, oct) => (acc << 8) + (Number(oct) & 0xff), 0) >>> 0;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  try {
    return (toInt(range) & mask) === (toInt(addr) & mask);
  } catch {
    return false;
  }
}

/** Extract the IP inputs from a Next.js Request / Headers object. */
export function ipInputFromHeaders(
  headers: Headers,
  socketRemoteAddr: string | null,
): RequestIpInput {
  return {
    socketRemoteAddr,
    xForwardedFor: headers.get("x-forwarded-for"),
    xRealIp: headers.get("x-real-ip"),
  };
}
