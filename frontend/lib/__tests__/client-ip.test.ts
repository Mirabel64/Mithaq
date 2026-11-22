import { describe, it, expect } from "vitest";
import {
  normalizeIp,
  readClientIpConfig,
  resolveClientIp,
  UNKNOWN_CLIENT_IP,
  type ClientIpConfig,
} from "../client-ip";

function headers(values: Record<string, string>): { get(name: string): string | null } {
  const lower = new Map(Object.entries(values).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (name: string) => lower.get(name.toLowerCase()) ?? null };
}

function config(trustedProxyHops: number, header: ClientIpConfig["header"] = "x-forwarded-for") {
  return { trustedProxyHops, header };
}

// ---------------------------------------------------------------------------
// readClientIpConfig
// ---------------------------------------------------------------------------

describe("readClientIpConfig", () => {
  it("trusts nothing and reads x-forwarded-for when unset", () => {
    expect(readClientIpConfig({})).toEqual({
      trustedProxyHops: 0,
      header: "x-forwarded-for",
    });
  });

  it("reads a positive hop count", () => {
    expect(readClientIpConfig({ TRUSTED_PROXY_HOPS: "2" }).trustedProxyHops).toBe(2);
  });

  it("trims the hop count", () => {
    expect(readClientIpConfig({ TRUSTED_PROXY_HOPS: " 1 " }).trustedProxyHops).toBe(1);
  });

  it.each(["", "abc", "-1", "1.5", "0x2", "ten"])(
    "falls back to zero hops for %j (fail closed)",
    (raw) => {
      expect(readClientIpConfig({ TRUSTED_PROXY_HOPS: raw }).trustedProxyHops).toBe(0);
    },
  );

  it("accepts each supported header, case-insensitively", () => {
    expect(readClientIpConfig({ TRUSTED_CLIENT_IP_HEADER: "x-real-ip" }).header).toBe("x-real-ip");
    expect(
      readClientIpConfig({ TRUSTED_CLIENT_IP_HEADER: "CF-Connecting-IP" }).header,
    ).toBe("cf-connecting-ip");
    expect(
      readClientIpConfig({ TRUSTED_CLIENT_IP_HEADER: " X-Forwarded-For " }).header,
    ).toBe("x-forwarded-for");
  });

  it("falls back to x-forwarded-for for an unsupported header name", () => {
    expect(readClientIpConfig({ TRUSTED_CLIENT_IP_HEADER: "forwarded" }).header).toBe(
      "x-forwarded-for",
    );
  });
});

// ---------------------------------------------------------------------------
// normalizeIp
// ---------------------------------------------------------------------------

describe("normalizeIp", () => {
  it("returns IPv4 addresses unchanged", () => {
    expect(normalizeIp("203.0.113.7")).toBe("203.0.113.7");
    expect(normalizeIp("  203.0.113.7  ")).toBe("203.0.113.7");
  });

  it("drops an IPv4 port", () => {
    expect(normalizeIp("203.0.113.7:51234")).toBe("203.0.113.7");
  });

  it("drops a bracketed IPv6 port", () => {
    expect(normalizeIp("[2001:db8::1]:443")).toBe("2001:db8::1");
    expect(normalizeIp("[2001:db8::1]")).toBe("2001:db8::1");
  });

  it("drops an IPv6 zone identifier", () => {
    expect(normalizeIp("fe80::1%eth0")).toBe("fe80::1");
  });

  it("lowercases and compresses IPv6", () => {
    expect(normalizeIp("2001:0DB8:0000:0000:0000:0000:0000:0001")).toBe("2001:db8::1");
    expect(normalizeIp("::1")).toBe("::1");
    expect(normalizeIp("::")).toBe("::");
  });

  it("keeps a single zero group uncompressed (RFC 5952)", () => {
    expect(normalizeIp("2001:db8:0:1:1:1:1:1")).toBe("2001:db8:0:1:1:1:1:1");
  });

  it("compresses the longest zero run", () => {
    expect(normalizeIp("2001:0:0:1:0:0:0:1")).toBe("2001:0:0:1::1");
  });

  it("unwraps IPv4-mapped IPv6", () => {
    expect(normalizeIp("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(normalizeIp("0:0:0:0:0:ffff:203.0.113.7")).toBe("203.0.113.7");
  });

  it.each([
    "",
    "   ",
    "not-an-ip",
    "256.0.0.1",
    "1.2.3",
    "1.2.3.4.5",
    "01.2.3.4",
    "1.2.3.4:http",
    "2001:db8::1::2",
    ":::",
    "12345::1",
    "[::1",
    "::1]",
    "1.2.3.4/24",
  ])("rejects %j", (raw) => {
    expect(normalizeIp(raw)).toBeNull();
  });

  it("rejects null and undefined", () => {
    expect(normalizeIp(null)).toBeNull();
    expect(normalizeIp(undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolveClientIp — proxy boundary
// ---------------------------------------------------------------------------

describe("resolveClientIp", () => {
  it("ignores every forwarding header when no proxy is configured", () => {
    const spoofed = headers({
      "x-forwarded-for": "203.0.113.9, 10.0.0.1",
      "x-real-ip": "203.0.113.10",
      "cf-connecting-ip": "203.0.113.11",
    });
    expect(resolveClientIp(spoofed, config(0))).toBe(UNKNOWN_CLIENT_IP);
    expect(
      resolveClientIp(headers({ "cf-connecting-ip": "203.0.113.11" }), config(0, "cf-connecting-ip")),
    ).toBe(UNKNOWN_CLIENT_IP);
  });

  it("uses the only hop when one proxy is configured", () => {
    expect(resolveClientIp(headers({ "x-forwarded-for": "203.0.113.7" }), config(1))).toBe(
      "203.0.113.7",
    );
  });

  it("ignores caller-supplied entries to the left of the trusted hop", () => {
    // A client that sends its own XFF arrives as "<spoofed>, <real client>".
    const req = headers({ "x-forwarded-for": "1.1.1.1, 198.51.100.4" });
    expect(resolveClientIp(req, config(1))).toBe("198.51.100.4");
  });

  it("skips the configured number of proxy hops", () => {
    const req = headers({ "x-forwarded-for": "198.51.100.4, 10.0.0.2, 10.0.0.3" });
    expect(resolveClientIp(req, config(2))).toBe("10.0.0.2");
    expect(resolveClientIp(req, config(3))).toBe("198.51.100.4");
  });

  it("reports unknown when the header has fewer entries than configured hops", () => {
    expect(resolveClientIp(headers({ "x-forwarded-for": "198.51.100.4" }), config(2))).toBe(
      UNKNOWN_CLIENT_IP,
    );
    expect(resolveClientIp(headers({}), config(1))).toBe(UNKNOWN_CLIENT_IP);
  });

  it("reports unknown for a malformed entry instead of using it as a key", () => {
    expect(resolveClientIp(headers({ "x-forwarded-for": "198.51.100.4, bogus" }), config(1))).toBe(
      UNKNOWN_CLIENT_IP,
    );
  });

  it("normalises the resolved address", () => {
    expect(resolveClientIp(headers({ "x-forwarded-for": "::ffff:198.51.100.4" }), config(1))).toBe(
      "198.51.100.4",
    );
    expect(resolveClientIp(headers({ "x-forwarded-for": " 198.51.100.4 , 10.0.0.1" }), config(1))).toBe(
      "10.0.0.1",
    );
  });

  it("reads x-real-ip only when that header is the configured source", () => {
    const req = headers({ "x-real-ip": "198.51.100.4", "x-forwarded-for": "1.1.1.1" });
    expect(resolveClientIp(req, config(1))).toBe("1.1.1.1");
    expect(resolveClientIp(req, config(1, "x-real-ip"))).toBe("198.51.100.4");
  });

  it("reads cf-connecting-ip only when that header is the configured source", () => {
    const req = headers({ "cf-connecting-ip": "198.51.100.4" });
    expect(resolveClientIp(req, config(1))).toBe(UNKNOWN_CLIENT_IP);
    expect(resolveClientIp(req, config(1, "cf-connecting-ip"))).toBe("198.51.100.4");
  });

  it("honours a custom fallback", () => {
    expect(resolveClientIp(headers({}), config(0), "0.0.0.0")).toBe("0.0.0.0");
  });

  it("treats a fractional or negative hop count as zero", () => {
    const req = headers({ "x-forwarded-for": "203.0.113.7" });
    expect(resolveClientIp(req, { trustedProxyHops: 1.5, header: "x-forwarded-for" })).toBe(
      UNKNOWN_CLIENT_IP,
    );
    expect(resolveClientIp(req, { trustedProxyHops: -1, header: "x-forwarded-for" })).toBe(
      UNKNOWN_CLIENT_IP,
    );
  });
});
