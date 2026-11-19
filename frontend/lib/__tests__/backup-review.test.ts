import { describe, it, expect } from "vitest";
import { describeBackupContents, isEmptyBackup } from "../backup-review";
import type { Credential } from "../credential";

function credential(type: Credential["type"]): Credential {
  return { type } as Credential;
}

describe("describeBackupContents (#66)", () => {
  it("summarises counts and types before download", () => {
    const review = describeBackupContents([
      credential("kyc"),
      credential("age"),
      credential("kyc"),
    ]);

    expect(review.credentialCount).toBe(3);
    expect(review.types).toEqual([
      { type: "age", count: 1 },
      { type: "kyc", count: 2 },
    ]);
    expect(review.encrypted).toBe(true);
    expect(review.containsPrivateValues).toBe(true);
    expect(review.summary).toContain("3 credentials: age (1), kyc (2)");
    expect(review.summary).toContain("passphrase-encrypted");
    expect(review.summary).toContain("nothing is uploaded");
  });

  it("handles an empty backup without claiming it has contents", () => {
    const review = describeBackupContents([]);
    expect(review.credentialCount).toBe(0);
    expect(review.summary).toContain("0 credentials");
    expect(isEmptyBackup(review)).toBe(true);
  });
});
