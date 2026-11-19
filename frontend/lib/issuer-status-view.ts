/**
 * lib/issuer-status-view.ts
 *
 * Holder-facing wording for the issuer-key signal on a credential (#72).
 *
 * `lib/issuer-registry.ts` already distinguishes a current key, a retired key,
 * a revoked key, a revoked issuer, and "we could not tell". That last state is
 * the important one: it must read as *unknown*, never as revoked, so a network
 * problem does not look like a verdict on the holder's credential.
 */

import type { Credential } from "./credential";

export type IssuerKeyStatus = NonNullable<Credential["issuerStatus"]>;

export interface IssuerStatusView {
  /** Short label shown in the credential detail view. */
  label: string;
  /** What the status means for this credential. */
  meaning: string;
  /** Effect on submitting a new proof. */
  submission: "unaffected" | "may-fail" | "will-fail" | "unknown";
  tone: "ok" | "warn" | "danger" | "muted";
}

const VIEWS: Record<IssuerKeyStatus, IssuerStatusView> = {
  active: {
    label: "Current issuer key",
    meaning:
      "The issuer is registered for this claim and the key that signed this credential is still valid.",
    submission: "unaffected",
    tone: "ok",
  },
  key_retired: {
    label: "Retired issuer key",
    meaning:
      "The issuer has rotated to a new key. This credential's key is still accepted, so proving works; no action is needed yet.",
    submission: "unaffected",
    tone: "warn",
  },
  key_revoked: {
    label: "Revoked issuer key",
    meaning:
      "The issuer's signing key was emergency-revoked. Submissions signed with this key may fail — ask the issuer for a fresh credential.",
    submission: "may-fail",
    tone: "danger",
  },
  issuer_revoked: {
    label: "Issuer revoked",
    meaning:
      "The issuer was removed from the registry. Proofs from this credential will be rejected — you need a credential from another issuer.",
    submission: "will-fail",
    tone: "danger",
  },
  unknown: {
    label: "Issuer key status unknown",
    meaning:
      "The issuer registry could not be read, so this key's status is unknown — not revoked. Retry when the network is available.",
    submission: "unknown",
    tone: "muted",
  },
};

/**
 * Describe an issuer status for the UI. A credential that has never been
 * checked (no stored status) is reported as `unknown` rather than guessed to
 * be active.
 */
export function describeIssuerStatus(
  status: Credential["issuerStatus"] | null | undefined,
): IssuerStatusView {
  return VIEWS[status ?? "unknown"] ?? VIEWS.unknown;
}
