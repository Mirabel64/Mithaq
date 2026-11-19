import { describe, it, expect } from "vitest";
import { describeIssuerStatus } from "../issuer-status-view";

describe("describeIssuerStatus", () => {
  it("describes a current key as unaffected", () => {
    const view = describeIssuerStatus("active");
    expect(view.label).toBe("Current issuer key");
    expect(view.submission).toBe("unaffected");
    expect(view.tone).toBe("ok");
  });

  it("keeps a retired key distinct from a revoked one", () => {
    expect(describeIssuerStatus("key_retired").submission).toBe("unaffected");
    expect(describeIssuerStatus("key_revoked").submission).toBe("may-fail");
    expect(describeIssuerStatus("issuer_revoked").submission).toBe("will-fail");
  });

  it("treats missing registry data as unknown, not revoked", () => {
    for (const view of [
      describeIssuerStatus("unknown"),
      describeIssuerStatus(undefined),
      describeIssuerStatus(null),
    ]) {
      expect(view.label).toBe("Issuer key status unknown");
      expect(view.submission).toBe("unknown");
      expect(view.meaning).toContain("not revoked");
    }
  });
});
