import { afterEach, describe, expect, it, vi } from "vitest";

async function withMode(
  mode: "none" | "single" | "list" | "vercel",
  proxies: string,
  fn: (deriveClientIp: typeof import("@/lib/ip").deriveClientIp) => void,
) {
  vi.resetModules();
  process.env.TRUSTED_PROXY_MODE = mode;
  process.env.TRUSTED_PROXIES = proxies;
  const mod = await import("@/lib/ip");
  fn(mod.deriveClientIp);
}

afterEach(() => {
  process.env.TRUSTED_PROXY_MODE = "none";
  process.env.TRUSTED_PROXIES = "";
  vi.resetModules();
});

describe("deriveClientIp - never trusts client headers unless the operator opts in", () => {
  it("mode=none ignores X-Forwarded-For entirely", async () => {
    await withMode("none", "", (derive) => {
      expect(
        derive({
          socketRemoteAddr: "203.0.113.9",
          xForwardedFor: "1.2.3.4, 5.6.7.8",
          xRealIp: "9.9.9.9",
        }),
      ).toBe("203.0.113.9");
    });
  });

  it("mode=single takes the last XFF hop (appended by the single trusted proxy)", async () => {
    await withMode("single", "", (derive) => {
      expect(
        derive({
          socketRemoteAddr: "10.0.0.1",
          xForwardedFor: "1.1.1.1, 2.2.2.2, 203.0.113.5",
          xRealIp: null,
        }),
      ).toBe("203.0.113.5");
    });
  });

  it("mode=list walks past trusted proxy CIDRs to the real client", async () => {
    await withMode("list", "10.0.0.0/8,192.168.0.0/16", (derive) => {
      expect(
        derive({
          socketRemoteAddr: "10.0.0.1",
          xForwardedFor: "198.51.100.23, 192.168.1.5, 10.1.2.3",
          xRealIp: null,
        }),
      ).toBe("198.51.100.23");
    });
  });

  it("mode=vercel uses x-real-ip (platform-set) over a spoofed XFF", async () => {
    await withMode("vercel", "", (derive) => {
      expect(
        derive({
          socketRemoteAddr: "10.0.0.1",
          xForwardedFor: "1.1.1.1, 9.9.9.9",
          xRealIp: "203.0.113.77",
        }),
      ).toBe("203.0.113.77");
    });
  });

  it("strips IPv6-mapped IPv4 and ports", async () => {
    await withMode("none", "", (derive) => {
      expect(
        derive({ socketRemoteAddr: "::ffff:203.0.113.9", xForwardedFor: null, xRealIp: null }),
      ).toBe("203.0.113.9");
    });
  });
});
