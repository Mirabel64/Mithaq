import { describe, it, expect, vi } from "vitest";
import { refreshCredentialStatuses } from "../issuer-status-refresh";
import type { Credential } from "../credential";

function credential(overrides: Partial<Credential> = {}): Credential {
  return {
    type: "kyc",
    issuerId: "GISSUER",
    issuerPubX: Array(32).fill(1),
    issuerPubY: Array(32).fill(2),
    issuerStatus: "active",
    ...overrides,
  } as Credential;
}

describe("refreshCredentialStatuses (#63)", () => {
  it("applies a fresh status and timestamp to every checkable credential", async () => {
    const check = vi.fn().mockResolvedValue("key_retired");
    const result = await refreshCredentialStatuses([credential()], "GHOLDER", {
      check,
      now: () => 1_700_000_000,
    });

    expect(check).toHaveBeenCalledWith(
      "GISSUER",
      "kyc",
      Array(32).fill(1),
      Array(32).fill(2),
      "GHOLDER",
    );
    expect(result.checked).toBe(1);
    expect(result.changed).toBe(1);
    expect(result.credentials[0].issuerStatus).toBe("key_retired");
    expect(result.credentials[0].issuerStatusCheckedAt).toBe(1_700_000_000);
  });

  it("treats a failed read as unknown, never as revoked", async () => {
    const check = vi.fn().mockRejectedValue(new Error("timed out"));
    const result = await refreshCredentialStatuses([credential()], "GHOLDER", {
      check,
    });

    expect(result.unknown).toBe(1);
    expect(result.credentials[0].issuerStatus).toBe("unknown");
  });

  it("leaves credentials without issuer key details untouched", async () => {
    const check = vi.fn();
    const bare = credential({ issuerId: "", issuerPubX: undefined as never });
    const result = await refreshCredentialStatuses([bare], "GHOLDER", {
      check,
    });

    expect(check).not.toHaveBeenCalled();
    expect(result.checked).toBe(0);
    expect(result.credentials[0]).toBe(bare);
  });

  it("counts only real status changes", async () => {
    const check = vi.fn().mockResolvedValue("active");
    const result = await refreshCredentialStatuses([credential()], "GHOLDER", {
      check,
    });
    expect(result.changed).toBe(0);
  });
});
