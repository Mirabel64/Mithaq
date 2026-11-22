# API Deployment Profiles

This document provides example deployment profiles for the Mithaq API/frontend service. It covers a local single-instance development profile and a multi-instance production profile, including required secrets, health checks, rate limits, and webhook settings.

> **Development-only defaults must not be used in production.** Any value marked `DEV ONLY` below is insecure, non-durable, or intended for local testing.

## 1. Local single-instance profile (SQLite/local development)

Use this profile for local development, demos, and contract/integration testing on one machine. It favors simple setup over durability.

### Example `.env.local`

```dotenv
# --- Runtime ---
NODE_ENV=development
LOG_LEVEL=debug
APP_ORIGIN=http://localhost:3000
NEXT_PUBLIC_MITHAQ_BASE_URL=http://localhost:3000

# --- Network / contracts ---
NEXT_PUBLIC_STELLAR_NETWORK=testnet
NEXT_PUBLIC_RPC_URL=https://soroban-testnet.stellar.org
NEXT_PUBLIC_NETWORK_PASSPHRASE=Test SDF Network ; September 2015

# --- Local persistence (DEV ONLY example) ---
# Use a local SQLite file for local-only services/tools that support SQLite.
# Do not use SQLite file storage for horizontally scaled production API instances.
DATABASE_URL=file:./.data/mithaq-dev.db

# --- Shared state / rate limits (single instance) ---
# In-process stores are acceptable for one local instance only.
# Leave Upstash/Redis unset for local single-instance development.
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
REDIS_URL=

# Rate-limit window and per-route limits (tune for local dev)
RATE_LIMIT_WINDOW_SECONDS=60
RATE_LIMIT_ISSUE_IP=20
RATE_LIMIT_ISSUE_WALLET=10
RATE_LIMIT_WITNESS_IP=60
RATE_LIMIT_PLAID_IP=30
RATE_LIMIT_CSP_REPORT_IP=60

# --- Idempotency ---
# DEV ONLY: local ephemeral idempotency is acceptable on a single dev process.
# Set a real 32-byte hex key before using batch idempotency replay outside throwaway dev.
IDEMPOTENCY_REPLAY_ENCRYPTION_KEY=
IDEMPOTENCY_TTL_SECONDS=60
IDEMPOTENCY_MAX_ENTRIES=10000

# --- Provider credentials (DEV ONLY when unset/mock) ---
# Leaving these unset enables demo/mock behavior in supported flows. Do not deploy unset.
ISSUER_PRIVATE_KEY=
PERSONA_API_KEY=
PERSONA_KYC_TEMPLATE_ID=
PERSONA_WEBHOOK_SECRET=
PLAID_CLIENT_ID=
PLAID_SECRET=
PLAID_ACCESS_TOKEN=
PLAID_ACCESS_TOKENS=
PLAID_ENV=sandbox

# --- Webhooks / outbound sinks ---
# DEV ONLY: leave blank to disable outbound delivery.
OUTBOUND_SINK_URL=
ISSUANCE_WEBHOOK_SECRET=dev-only-webhook-secret
```

### Health checks

- Liveness/basic: `GET /api/health`
- Readiness: `GET /api/ready`

For local smoke checks, confirm both endpoints return 200 before running manual API flows.

### Rate limits and webhook notes

- Keep rate limits enabled even locally; they protect against accidental request loops.
- `ISSUANCE_WEBHOOK_SECRET` must be a strong secret in real deployments. The example above is **DEV ONLY**.
- Persona webhook endpoint: `POST /api/webhooks/issuance` (configure provider signature secret to match `ISSUANCE_WEBHOOK_SECRET` / `PERSONA_WEBHOOK_SECRET` as applicable).
- If testing webhooks locally, use an HTTPS tunnel and never reuse production secrets.

## 2. Multi-instance PostgreSQL profile (production)

Use this profile for horizontally scaled API deployments behind a load balancer. All instances must share durable state where required.

### Example production environment

```dotenv
# --- Runtime ---
NODE_ENV=production
LOG_LEVEL=info
APP_ORIGIN=https://app.example.com
NEXT_PUBLIC_MITHAQ_BASE_URL=https://app.example.com

# --- Network / contracts ---
NEXT_PUBLIC_STELLAR_NETWORK=mainnet
NEXT_PUBLIC_RPC_URL=https://<production-soroban-rpc>
NEXT_PUBLIC_NETWORK_PASSPHRASE=Public Global Stellar Network ; September 2015

# --- PostgreSQL (shared durable database) ---
DATABASE_URL=postgresql://mithaq_app:<strong-password>@db-primary.internal:5432/mithaq?sslmode=require
# Optional read replica for read-heavy workloads (if supported by the service using it):
# DATABASE_READ_URL=postgresql://mithaq_read:<strong-password>@db-replica.internal:5432/mithaq?sslmode=require

# --- Shared distributed store (required for multi-instance rate limiting/idempotency) ---
UPSTASH_REDIS_REST_URL=https://<upstash-rest-endpoint>
UPSTASH_REDIS_REST_TOKEN=<upstash-rest-token>
# Or self-managed Redis-compatible deployment:
# REDIS_URL=rediss://:<redis-password>@redis.internal:6380

# --- Rate limits ---
RATE_LIMIT_WINDOW_SECONDS=60
RATE_LIMIT_ISSUE_IP=10
RATE_LIMIT_ISSUE_WALLET=5
RATE_LIMIT_WITNESS_IP=30
RATE_LIMIT_PLAID_IP=10
RATE_LIMIT_CSP_REPORT_IP=30

# --- Idempotency ---
# Required for encrypted batch replay records. Use a 32-byte hex key and rotate only after TTL expiry.
IDEMPOTENCY_REPLAY_ENCRYPTION_KEY=<64-hex-chars>
IDEMPOTENCY_TTL_SECONDS=60
IDEMPOTENCY_MAX_ENTRIES=10000

# --- Required secrets / provider config ---
ISSUER_PRIVATE_KEY=<64-hex-secp256k1-private-key>
PERSONA_API_KEY=<persona-api-key>
PERSONA_KYC_TEMPLATE_ID=<persona-template-id>
PERSONA_WEBHOOK_SECRET=<persona-webhook-secret>
PLAID_CLIENT_ID=<plaid-client-id>
PLAID_SECRET=<plaid-secret>
PLAID_ACCESS_TOKEN=<plaid-access-token>
PLAID_ACCESS_TOKENS=<optional-comma-separated-additional-tokens>
PLAID_ENV=production

# --- Webhooks / outbound sinks ---
ISSUANCE_WEBHOOK_SECRET=<strong-random-secret>
OUTBOUND_SINK_URL=https://ops.example.com/mithaq/sink
OUTBOUND_SINK_QUEUE_SIZE=256
METRICS_TOKEN=<strong-random-metrics-token>
SENTRY_DSN=https://<key>@sentry.io/<project>
```

### Required secrets

Configure these through a secret manager (not committed files):

- `ISSUER_PRIVATE_KEY` - issuer signing key; never expose publicly.
- `PERSONA_*` - identity provider credentials and webhook secret.
- `PLAID_*` - balance attestation credentials/tokens.
- `ISSUANCE_WEBHOOK_SECRET` / `PERSONA_WEBHOOK_SECRET` - webhook HMAC verification secrets.
- `IDEMPOTENCY_REPLAY_ENCRYPTION_KEY` - encrypts idempotent batch replay records.
- `UPSTASH_REDIS_REST_TOKEN` / `REDIS_URL` credentials - shared store access.
- `METRICS_TOKEN`, `SENTRY_DSN`, outbound sink credentials as applicable.

### Health checks and deployment probes

- **Liveness:** `GET /api/health` - process is up.
- **Readiness:** `GET /api/ready` - required config/dependencies are usable before receiving traffic.

Recommended probe settings (adjust for your platform):

- Readiness path: `/api/ready`, interval 10s, timeout 2s, failure threshold 3.
- Liveness path: `/api/health`, interval 20s, timeout 2s, failure threshold 3.
- Do not route public traffic until readiness passes.

### Rate limits

- Set `RATE_LIMIT_*` values for expected traffic and abuse tolerance.
- In multi-instance deployments, configure a shared store (`UPSTASH_REDIS_*` or `REDIS_URL`) so limits are enforced globally.
- Keep webhook and public endpoints rate-limited; monitor 429 rates and adjust carefully.

### Webhook settings

- **Persona/issuance webhook:** `POST /api/webhooks/issuance`
- Require HMAC signature verification (`PERSONA_WEBHOOK_SECRET` / `ISSUANCE_WEBHOOK_SECRET`).
- Use HTTPS-only public endpoints.
- Configure provider retry behavior and keep handlers idempotent.
- Log request IDs and verification outcomes; never log raw secrets or sensitive identity payloads.

## Production checklist

- [ ] No `DEV ONLY` defaults in environment.
- [ ] All secrets loaded from secret manager / platform secret store.
- [ ] PostgreSQL configured with TLS, backups, and least-privilege credentials.
- [ ] Shared Redis/Upstash configured for multi-instance rate limiting/idempotency.
- [ ] `/api/health` and `/api/ready` probes configured.
- [ ] Rate limits tuned and monitored.
- [ ] Webhook secrets configured and signature verification tested.
- [ ] Metrics/error reporting configured (`METRICS_TOKEN`, `SENTRY_DSN`, outbound sink).

## Provider timeout budgets (API-42)

External identity-provider calls must have explicit end-to-end timeouts so stalled upstreams do not consume resources or leave issuance stuck:

| Provider call | Budget | Behavior on timeout |
|---|---:|---|
| Persona create inquiry | 8s (`PERSONA_TIMEOUT_MS`) | Request aborted; issuance flow returns provider-unavailable error |
| Persona retrieve inquiry | 8s (`PERSONA_TIMEOUT_MS`) | Request aborted; caller receives controlled error |
| Plaid balance item fetch | 8s (`PLAID_TIMEOUT_MS`) | Per-item abort; aggregate fails closed with `PLAID_TIMEOUT` |
| Multi-item Plaid aggregate | `<= 25 items * 8s` bounded by per-item timeout and `MAX_PLAID_ITEMS` | Any item timeout/failure fails the aggregate; no partial sum is attested |

Cancellation is enforced with `AbortController` so timed-out fetches are aborted.
