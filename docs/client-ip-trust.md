# Client IP trust behind proxies (API-28)

Every IP-keyed limit in the API (rate limiting, the `/api/usage` dashboard,
abuse logging) needs one thing to be meaningful: an address the caller cannot
choose. Behind a reverse proxy the TCP peer is the proxy, so the caller's
address only exists in a forwarding header — and headers are written by whoever
connects.

## Default: trust nothing

`lib/client-ip.ts` ignores **every** forwarding header unless the deployment
declares a proxy boundary. With no configuration, `extractIp()` returns
`"unknown"`.

That is fail-closed on purpose:

- A caller cannot mint fresh rate-limit buckets by sending `X-Forwarded-For`.
- A caller cannot exhaust another user's quota by naming their address.
- The cost of a missing config is one shared bucket (a global limit), not a
  bypass.

## The proxy boundary

| Variable | Default | Meaning |
| --- | --- | --- |
| `TRUSTED_PROXY_HOPS` | `0` | Number of proxies **you operate** directly in front of the app. `0` disables all header trust. |
| `TRUSTED_CLIENT_IP_HEADER` | `x-forwarded-for` | Which header the trusted proxy writes: `x-forwarded-for`, `x-real-ip`, or `cf-connecting-ip`. |

Proxies **append** to `X-Forwarded-For`; the right-most entry was written by the
closest proxy you control, and anything further left may have been supplied by
the caller. The resolver reads `hops` entries from the right:

```
client -> nginx -> app              XFF: "198.51.100.4"                   hops=1 -> 198.51.100.4
client -> CF -> nginx -> app        XFF: "198.51.100.4, 172.71.x.x"      hops=2 -> 198.51.100.4
```

With `hops=1`, a caller that sends `X-Forwarded-For: 10.0.0.1` arrives as
`"10.0.0.1, 198.51.100.4"` and is still keyed on `198.51.100.4`: only the hop
your proxy added is believed. If the header carries fewer entries than the
configured hop count, the request did not traverse the configured chain and the
caller is reported as `"unknown"`.

`x-real-ip` and `cf-connecting-ip` are single-valued and overwritten by the
proxy, so they are read verbatim — but only when selected explicitly **and**
`TRUSTED_PROXY_HOPS >= 1`. A header name that is not one of the three falls
back to `x-forwarded-for`; an invalid hop count (negative, fractional,
non-numeric) falls back to `0`.

## Network requirement (important)

Next.js route handlers do not expose the TCP peer address, so the application
cannot verify that a connection actually came from your proxy. `hops` is only
safe when the app is **unreachable except through those proxies**:

- bind the server to loopback or a private interface (e.g. `next start -H
  127.0.0.1`) and let nginx/Cloudflare Tunnel be the only ingress, or
- firewall the container/service so only the proxy's address may connect.

If the app is directly reachable, an attacker can bypass the proxy and send a
chosen header; no hop count can detect that.

## Deployment examples

**nginx in front of `next start` (one proxy)**

```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

```bash
TRUSTED_PROXY_HOPS=1
```

**Cloudflare in front of nginx (two proxies)**

```bash
TRUSTED_PROXY_HOPS=2
# or, if nginx forwards Cloudflare's header untouched:
# TRUSTED_PROXY_HOPS=1
# TRUSTED_CLIENT_IP_HEADER=cf-connecting-ip
```

**Single instance with no proxy**

Leave both variables unset. Every caller shares the `"unknown"` bucket, which is
correct for a local/dev instance but should not be used where per-IP limits
matter.

## Validation

- Addresses are canonicalised before use as a key: IPv4 and IPv6 are both
  accepted, IPv6 is compressed per RFC 5952, IPv4-mapped IPv6
  (`::ffff:198.51.100.4`) is unwrapped to IPv4, and zone IDs / ports are
  stripped.
- Anything that is not a valid address is discarded rather than used, so a
  malformed header cannot become a store key.
- Raw addresses are never logged — see `hashForLog()` in `lib/rate-limit.ts`.

Boundary coverage lives in `frontend/lib/__tests__/client-ip.test.ts`
(header trust matrix, hop counting, spoofed prefixes, malformed values) and in
the `extractIp` cases in `frontend/lib/__tests__/rate-limit.test.ts`.
