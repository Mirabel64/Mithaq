import { describe, expect, it } from "vitest";
import {
  parseCredentialDocument,
  parseCredentialDocumentReport,
  serializeCredentialDocument,
} from "../credential-json";

const credential = {
  type: "kyc",
  title: "KYC Complete",
  claim: "identity verified",
  issuer: "Test issuer",
  issuerId: "test-issuer",
  holder: "GABCDEXAMPLEHOLDERADDRESS",
  value: "0x12",
  salt: "0x34",
  commitment: "0x56",
  sig: Array(64).fill(1),
  issuerPubX: Array(32).fill(2),
  issuerPubY: Array(32).fill(3),
  issuedAt: 1,
  expiry: "90 days",
  extension: { retained: true },
};

describe("credential JSON helpers", () => {
  it("round trips a credential array without changing credential fields", () => {
    const parsed = parseCredentialDocument(JSON.stringify([credential]));
    expect(parsed).toEqual([credential]);
    expect(JSON.parse(serializeCredentialDocument(parsed))).toEqual([
      credential,
    ]);
  });

  it("accepts a single credential and rejects encrypted backup envelopes", () => {
    expect(parseCredentialDocument(JSON.stringify(credential))).toEqual(
      credential,
    );
    expect(() =>
      parseCredentialDocument(
        JSON.stringify({ version: 3, ciphertext: "..." }),
      ),
    ).toThrow(/Import them in the app with the backup passphrase/);
  });

  it("rejects malformed credential entries using the app parser", () => {
    expect(() =>
      parseCredentialDocument(JSON.stringify([{ type: "unsupported" }])),
    ).toThrow(/type must be one of/);
  });
});

describe("parseCredentialDocumentReport (#67)", () => {
  it("keeps valid records and reports each invalid one with its position", () => {
    const report = parseCredentialDocumentReport(
      JSON.stringify([
        credential,
        { type: "unsupported" },
        { ...credential, commitment: "" },
      ]),
    );

    expect(report.document).toBe("array");
    expect(report.valid).toEqual([credential]);
    expect(report.invalid.map((issue) => issue.index)).toEqual([1, 2]);
    expect(report.invalid[0].reason).toMatch(/type must be one of/);
    expect(report.invalid[1].reason).toMatch(/commitment/);
  });

  it("never echoes a rejected record's secret values in the reason", () => {
    const secret = "0xdeadbeefcafebabe";
    const report = parseCredentialDocumentReport(
      JSON.stringify([{ ...credential, value: secret, sig: [1] }]),
    );

    expect(report.valid).toHaveLength(0);
    expect(report.invalid).toHaveLength(1);
    expect(report.invalid[0].reason).not.toContain(secret);
    expect(JSON.stringify(report.invalid)).not.toContain(secret);
  });

  it("reports a single invalid document without throwing", () => {
    const report = parseCredentialDocumentReport(
      JSON.stringify({ type: "unsupported" }),
    );
    expect(report.document).toBe("single");
    expect(report.valid).toHaveLength(0);
    expect(report.invalid[0].index).toBe(0);
  });

  it("accepts a single valid credential as before", () => {
    const report = parseCredentialDocumentReport(JSON.stringify(credential));
    expect(report).toEqual({
      valid: [credential],
      invalid: [],
      document: "single",
    });
  });
});
