import { parseCredential, type Credential } from "./credential";

/** One record that failed validation, with a reason safe to display. */
export interface CredentialImportIssue {
  /** Zero-based position of the record in the imported file. */
  index: number;
  /**
   * Why the record was rejected. Comes from `parseCredential`, which names the
   * offending field but never echoes its value, so secrets cannot leak into
   * the UI or a log line.
   */
  reason: string;
}

export interface CredentialImportReport {
  /** Records that passed validation and may be saved. */
  valid: Credential[];
  /** Records that failed, in file order. */
  invalid: CredentialImportIssue[];
  /** Whether the document was a multi-record import or a single credential. */
  document: "single" | "array";
}

/**
 * Validate every record in an import document without aborting on the first
 * failure (#67), so the holder can see which records are usable and which are
 * not before anything is written to local storage.
 */
export function parseCredentialDocumentReport(
  json: string,
): CredentialImportReport {
  const value = JSON.parse(json) as unknown;

  if (Array.isArray(value)) {
    const valid: Credential[] = [];
    const invalid: CredentialImportIssue[] = [];

    value.forEach((record, index) => {
      try {
        valid.push(parseCredential(JSON.stringify(record)));
      } catch (error) {
        invalid.push({ index, reason: (error as Error).message });
      }
    });

    return { valid, invalid, document: "array" };
  }

  if (value && typeof value === "object" && "version" in value) {
    throw new Error(
      "Encrypted backup envelopes are not plaintext credential exports. Import them in the app with the backup passphrase.",
    );
  }

  try {
    return {
      valid: [parseCredential(json)],
      invalid: [],
      document: "single",
    };
  } catch (error) {
    return {
      valid: [],
      invalid: [{ index: 0, reason: (error as Error).message }],
      document: "single",
    };
  }
}

/**
 * Strict parse used where a single document must be all-or-nothing. The
 * per-record report above is for the interactive import review.
 */
export function parseCredentialDocument(
  json: string,
): Credential | Credential[] {
  const report = parseCredentialDocumentReport(json);
  const firstIssue = report.invalid[0];
  if (firstIssue) {
    throw new Error(firstIssue.reason);
  }
  return report.document === "array" ? report.valid : report.valid[0];
}

export function serializeCredentialDocument(
  value: Credential | Credential[],
): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
