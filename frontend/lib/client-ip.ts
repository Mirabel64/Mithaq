/**
 * client-ip.ts — how the API decides which address a request came from.
 *
 * ## The problem
 *
 * Behind a reverse proxy the socket peer is the proxy, so the caller's address
 * only exists in a forwarding header. Those headers are written by whoever
 * connects: if the app trusts them unconditionally, any client can pick its own
 * rate-limit bucket (or somebody else's) by sending `X-Forwarded-For: <anything>`.
 *
 * ## The rule
 *
 * Nothing in a forwarding header is trusted by default. A deployment must say
 * how many proxies it operates in front of the app (`TRUSTED_PROXY_HOPS`), and
 * only that many right-most hops of `X-Forwarded-For` are believed. Proxies
 * append, so the right-most entry was written by the closest proxy we control,
 * while anything to its left may have been supplied by the caller.
 *
 *     client -> nginx -> app        XFF: "client"                 hops = 1
 *     client -> CF -> nginx -> app  XFF: "client, cloudflare-ip"  hops = 2
 *
 * With `hops = 0` (the default) every forwarding header is ignored and the
 * caller is reported as `"unknown"`. That is deliberately fail-closed: a
 * misconfigured deployment gets one shared rate-limit bucket rather than one
 * bucket per attacker-chosen string.
 *
 * ## Known limitation
 *
 * Next.js route handlers do not expose the TCP peer address, so the app cannot
 * itself verify that the connection came from a proxy. `TRUSTED_PROXY_HOPS` is
 * therefore only safe when the app is unreachable except through those proxies
 * (bind the server to loopback / a private network, or firewall it). See
 * `docs/client-ip-trust.md`.
 */

/** Headers this module is willing to read, in addition to `x-forwarded-for`. */
export type ClientIpHeader = "x-forwarded-for" | "x-real-ip" | "cf-connecting-ip";

const SUPPORTED_HEADERS: readonly ClientIpHeader[] = [
  "x-forwarded-for",
  "x-real-ip",
  "cf-connecting-ip",
];

/** Minimal shape shared by `Headers`, `NextRequest["headers"]` and test doubles. */
export interface HeaderReader {
  get(name: string): string | null | undefined;
}

export interface ClientIpConfig {
  /**
   * Number of reverse proxies operated in front of the app. `0` disables all
   * forwarded-header trust. Always an integer `>= 0`.
   */
  trustedProxyHops: number;
  /** Header that carries the caller's address. */
  header: ClientIpHeader;
}

/** Reported when no forwarded header may be trusted (or none is usable). */
export const UNKNOWN_CLIENT_IP = "unknown";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Resolve the trust configuration from the environment.
 *
 * - `TRUSTED_PROXY_HOPS` — integer, default `0`. Negative, fractional or
 *   non-numeric values fall back to `0` (fail closed).
 * - `TRUSTED_CLIENT_IP_HEADER` — one of `x-forwarded-for` (default),
 *   `x-real-ip`, `cf-connecting-ip`. An unrecognised value falls back to
 *   `x-forwarded-for`; hop trust is unaffected.
 */
export function readClientIpConfig(env: NodeJS.ProcessEnv = process.env): ClientIpConfig {
  const rawHops = env.TRUSTED_PROXY_HOPS?.trim();
  let trustedProxyHops = 0;
  if (rawHops && /^\d+$/.test(rawHops)) {
    trustedProxyHops = Number(rawHops);
  }

  const rawHeader = env.TRUSTED_CLIENT_IP_HEADER?.trim().toLowerCase();
  const header = (SUPPORTED_HEADERS as readonly string[]).includes(rawHeader ?? "")
    ? (rawHeader as ClientIpHeader)
    : "x-forwarded-for";

  return { trustedProxyHops, header };
}

// ---------------------------------------------------------------------------
// IP parsing and canonicalisation
// ---------------------------------------------------------------------------

function parseIpv4(value: string): number[] | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;

  const words: number[] = [];
  for (const part of parts) {
    // Reject empty groups, signs, leading zeros ("010" is ambiguous between
    // decimal and octal across stacks) and anything over 255.
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    words.push(octet);
  }
  return words;
}

function parseIpv6(value: string): number[] | null {
  let input = value.trim().toLowerCase();
  if (input.includes("%")) {
    // Zone identifier (fe80::1%eth0) — same address, not the caller's choice.
    input = input.slice(0, input.indexOf("%"));
  }
  if (!input.includes(":")) return null;

  // A trailing dotted-quad (::ffff:192.0.2.1) consumes the final two hextets.
  const tail: number[] = [];
  if (input.includes(".")) {
    const lastColon = input.lastIndexOf(":");
    if (lastColon === -1) return null;
    const ipv4 = parseIpv4(input.slice(lastColon + 1));
    if (!ipv4) return null;
    tail.push((ipv4[0] << 8) | ipv4[1], (ipv4[2] << 8) | ipv4[3]);
    input = input.slice(0, lastColon + 1);
    // "::ffff:" / "1:2:3:4:5:6:" -> drop the separator colon; "::" stays a
    // valid all-zero prefix on its own.
    if (!input.endsWith("::") && input.endsWith(":")) {
      input = input.slice(0, -1);
    }
  }

  const compressed = input.includes("::");
  if (input.indexOf("::") !== input.lastIndexOf("::")) return null;

  const [leftRaw, rightRaw] = compressed ? input.split("::") : [input, ""];
  const left = leftRaw ? leftRaw.split(":") : [];
  const right = rightRaw ? rightRaw.split(":") : [];

  const hexGroups: number[] = [];
  for (const group of [...left, ...right]) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    hexGroups.push(parseInt(group, 16));
  }

  const explicitCount = hexGroups.length + tail.length;
  if (compressed) {
    if (explicitCount >= 8) return null;
    const zeros = new Array(8 - explicitCount).fill(0);
    const splitAt = left.length;
    return [...hexGroups.slice(0, splitAt), ...zeros, ...hexGroups.slice(splitAt), ...tail];
  }

  if (explicitCount !== 8) return null;
  return [...hexGroups, ...tail];
}

function formatIpv6(words: number[]): string {
  // IPv4-mapped addresses (::ffff:a.b.c.d) are reported as plain IPv4.
  const mapped = words.slice(0, 5).every((w) => w === 0) && words[5] === 0xffff;
  if (mapped) {
    return `${words[6] >> 8}.${words[6] & 0xff}.${words[7] >> 8}.${words[7] & 0xff}`;
  }

  // RFC 5952: compress the longest run (>= 2) of zero groups, left-most on ties.
  let bestStart = -1;
  let bestLength = 0;
  for (let i = 0; i < 8; ) {
    if (words[i] !== 0) {
      i += 1;
      continue;
    }
    let end = i;
    while (end < 8 && words[end] === 0) end += 1;
    if (end - i > bestLength && end - i >= 2) {
      bestStart = i;
      bestLength = end - i;
    }
    i = end;
  }

  const hex = words.map((w) => w.toString(16));
  if (bestStart === -1) return hex.join(":");

  const left = hex.slice(0, bestStart).join(":");
  const right = hex.slice(bestStart + bestLength).join(":");
  return `${left}::${right}`;
}

/**
 * Canonicalise one address as it appeared in a header.
 *
 * Accepts a bare address, `[v6]`/`[v6]:port`, `v4:port`, zone IDs and
 * IPv4-mapped IPv6. Returns `null` for anything that is not a valid IP, so a
 * malformed or hostile header value can never become a rate-limit key.
 */
export function normalizeIp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let value = raw.trim();
  if (!value) return null;

  if (value.startsWith("[")) {
    const closing = value.indexOf("]");
    if (closing === -1) return null;
    const rest = value.slice(closing + 1);
    if (rest && !/^:\d{1,5}$/.test(rest)) return null;
    value = value.slice(1, closing);
  } else if (value.split(":").length === 2 && value.includes(".")) {
    // v4:port — a bare IPv6 address can never have exactly one colon.
    const [host, port] = value.split(":");
    if (!/^\d{1,5}$/.test(port)) return null;
    value = host;
  }

  const ipv4 = parseIpv4(value);
  if (ipv4) return ipv4.join(".");

  const ipv6 = parseIpv6(value);
  if (ipv6) return formatIpv6(ipv6);

  return null;
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

/**
 * Resolve the caller's address for one request.
 *
 * Never returns an unvalidated header value: every candidate goes through
 * {@link normalizeIp}, and anything unusable becomes `fallback`
 * (`"unknown"` by default).
 */
export function resolveClientIp(
  headers: HeaderReader,
  config: ClientIpConfig,
  fallback: string = UNKNOWN_CLIENT_IP,
): string {
  const hops = Number.isInteger(config.trustedProxyHops) ? config.trustedProxyHops : 0;
  if (hops < 1) return fallback;

  if (config.header === "x-real-ip" || config.header === "cf-connecting-ip") {
    // Single-valued headers: a trusted proxy overwrites them, so the value is
    // the caller's address (or a proxy's, which the operator configured away).
    return normalizeIp(headers.get(config.header)) ?? fallback;
  }

  const forwarded = headers.get("x-forwarded-for");
  if (!forwarded) return fallback;

  const entries = forwarded
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  // Each proxy appends one entry, so the caller sits `hops` entries from the
  // right. Fewer entries than hops means the request did not traverse the
  // configured chain (or a proxy overwrote the header) — do not guess.
  const index = entries.length - hops;
  if (index < 0) return fallback;

  return normalizeIp(entries[index]) ?? fallback;
}
