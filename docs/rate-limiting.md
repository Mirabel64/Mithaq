# Rate Limiting & Abuse Protection (#70)

The `/api/issue` endpoint incorporates strict rate limiting to protect against cost-inflation attacks and credential spam.

## Configuration & Enforced Limits
- **Per-IP Limit:** Configurable via `RATE_LIMIT_IP_PER_MIN` (default: 20 req/min).
- **Per-Wallet Limit:** Configurable via `RATE_LIMIT_WALLET_PER_HOUR` (default: 10 req/hour).
- **Backend:** Defaults to in-memory sliding window; switchable to Redis via `RATELIMIT_BACKEND=redis`.

## Client identity

Per-IP limits are only as trustworthy as the caller's address. Forwarding
headers (`X-Forwarded-For`, `X-Real-IP`, `CF-Connecting-IP`) are ignored unless
the deployment declares how many proxies it runs in front of the app
(`TRUSTED_PROXY_HOPS`); with none configured every caller is keyed as
`"unknown"`. See [client-ip-trust.md](./client-ip-trust.md).

## Privacy Guarantee
No identity or sensitive wallet fields are logged by the limiter.
