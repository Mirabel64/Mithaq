// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const HOLDER = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

function postRequest(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/issue", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function loadRoute() {
  vi.resetModules();
  return import("../route");
}

async function loadTenantRoute() {
  vi.resetModules();
  const route = await import("../route");
  const { setSecretsProvider, MockSecretsProvider } = await import("@/lib/secrets-vault");
  const { setTenantStore, InMemoryTenantStore } = await import("@/lib/tenancy");

  setSecretsProvider(new MockSecretsProvider({}));
  setTenantStore(
    new InMemoryTenantStore([
      {
        id: "tenant_alpha",
        name: "Alpha",
        apiKey: "sk_live_alpha_test_key_12345",
        status: "active",
        config: {
          issuerId: "GALPHA000000000000000000000000000000000000000000000000000",
          issuerName: "Alpha",
          signingKeySecretRef: "secret/alpha",
          allowedCredentialTypes: ["kyc", "age"],
        },
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ]),
  );

  return route;
}

describe("POST /api/issue contract error cases", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of [
      "ISSUER_PRIVATE_KEY",
      "PERSONA_API_KEY",
      "PERSONA_KYC_TEMPLATE_ID",
      "PLAID_CLIENT_ID",
      "PLAID_SECRET",
      "PLAID_ACCESS_TOKEN",
      "PLAID_ACCESS_TOKENS",
    ]) {
      savedEnv[key] = process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns documented error shape for malformed requests", async () => {
    delete process.env.ISSUER_PRIVATE_KEY;
    const { POST } = await loadRoute();

    const res = await POST(
      new NextRequest("http://localhost/api/issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({
      code: expect.any(String),
      error: expect.any(String),
      requestId: expect.any(String),
    });
  });

  it("returns documented error shape for tenant authorization failures", async () => {
    const { POST } = await loadTenantRoute();

    const res = await POST(
      postRequest(
        { credential_types: ["age"], holder: HOLDER, attributes: { date_of_birth: "1990-01-01" } },
        { "x-api-key": "sk_live_wrong_key" },
      ),
    );

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toMatchObject({
      code: expect.any(String),
      error: expect.any(String),
      requestId: expect.any(String),
    });
  });

  it("returns stable timeout error for provider timeouts", async () => {
    delete process.env.ISSUER_PRIVATE_KEY;
    process.env.PLAID_CLIENT_ID = "test-plaid-client-id";
    process.env.PLAID_SECRET = "test-plaid-secret";
    process.env.PLAID_ACCESS_TOKEN = "access-sandbox-token";

    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" })),
    );

    const { POST } = await loadRoute();
    const res = await POST(
      postRequest({
        credential_types: ["funds"],
        holder: HOLDER,
        issuerId: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBHF2",
      }),
    );

    expect([504, 502]).toContain(res.status);
    const body = await res.json();
    expect(body).toMatchObject({
      code: expect.stringMatching(/TIMEOUT|UNAVAILABLE|PLAID/),
      error: expect.any(String),
      requestId: expect.any(String),
    });
  });

  it("returns documented error shape for rate limits", async () => {
    delete process.env.ISSUER_PRIVATE_KEY;
    const { checkLimit } = await import("@/lib/rate-limit");
    // If checkLimit is not easily mockable via module, we fallback to high-volume? Avoid; mock module directly.
    vi.resetModules();
    vi.doMock("@/lib/rate-limit", async () => {
      const actual = await vi.importActual<typeof import("@/lib/rate-limit")>("@/lib/rate-limit");
      return {
        ...actual,
        checkLimit: vi.fn(() => ({ throttled: true, retryAfterMs: 1000 })),
      };
    });
    const { POST } = await import("../route");

    const res = await POST(
      postRequest({
        credential_types: ["kyc"],
        holder: HOLDER,
        issuerId: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBHF2",
      }),
    );

    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
    const body = await res.json();
    expect(body).toMatchObject({
      code: expect.any(String),
      error: expect.any(String),
      requestId: expect.any(String),
    });
  });

  it("replays idempotent retries without re-minting credentials", async () => {
    delete process.env.ISSUER_PRIVATE_KEY;
    const { POST } = await loadRoute();

    const body = {
      credential_types: ["kyc"],
      holder: HOLDER,
      issuerId: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBHF2",
    };
    const headers = { "Idempotency-Key": "contract-replay-key-1" };

    const first = await POST(postRequest(body, headers));
    expect(first.status).toBe(200);
    const firstBody = await first.json();

    const second = await POST(postRequest(body, headers));
    expect([200, 409]).toContain(second.status);
    const secondBody = await second.json();

    if (second.status === 200) {
      expect(secondBody).toEqual(firstBody);
    } else {
      expect(secondBody).toMatchObject({
        code: expect.any(String),
        error: expect.any(String),
        requestId: expect.any(String),
      });
      expect(second.headers.get("X-Idempotent")).toBe("true");
    }
  });
});
