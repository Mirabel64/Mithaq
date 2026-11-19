"use client";

/**
 * lib/issuer-status-refresh.ts
 *
 * Manual refresh of on-chain issuer/proof status (#63).
 *
 * The holder page checks status in the background at most every five minutes,
 * so a holder who just re-issued or whose issuer rotated a key has no way to
 * ask for an immediate answer. This module performs one explicit pass and
 * reports what changed, treating a failed read as `unknown` — never as
 * `revoked` and never as `active`.
 */

import type { Credential } from "./credential";
import { checkIssuerStatus, type IssuerStatus } from "./issuer-registry";

export type StatusChecker = (
  issuerId: string,
  credentialType: string,
  issuerPubX: number[],
  issuerPubY: number[],
  simulationAccount: string,
) => Promise<IssuerStatus>;

export interface StatusRefreshResult {
  /** Credentials with the freshly checked status and timestamp applied. */
  credentials: Credential[];
  /** How many credentials' status actually changed. */
  changed: number;
  /** How many credentials ended up `unknown` (the registry could not tell). */
  unknown: number;
  /** How many credentials were checked this pass. */
  checked: number;
}

export interface StatusRefreshOptions {
  /** Injectable for tests; defaults to the registry read. */
  check?: StatusChecker;
  /** Injectable clock (epoch seconds); defaults to now. */
  now?: () => number;
}

/**
 * Check every credential that carries the issuer identifiers the registry
 * needs. Credentials without them are returned untouched (their status was
 * never knowable from the chain).
 */
export async function refreshCredentialStatuses(
  credentials: Credential[],
  simulationAccount: string,
  options: StatusRefreshOptions = {},
): Promise<StatusRefreshResult> {
  const check = options.check ?? checkIssuerStatus;
  const now = options.now ? options.now() : Math.floor(Date.now() / 1000);

  let changed = 0;
  let unknown = 0;
  let checked = 0;

  const updated: Credential[] = [];

  for (const credential of credentials) {
    if (
      !credential.issuerId ||
      !credential.issuerPubX ||
      !credential.issuerPubY
    ) {
      updated.push(credential);
      continue;
    }

    let status: IssuerStatus;
    try {
      status = await check(
        credential.issuerId,
        credential.type,
        credential.issuerPubX,
        credential.issuerPubY,
        simulationAccount,
      );
    } catch {
      // A failed read is unknown, not a revocation.
      status = "unknown";
    }

    checked++;
    if (status === "unknown") unknown++;
    if (status !== credential.issuerStatus) changed++;

    updated.push({
      ...credential,
      issuerStatus: status,
      issuerStatusCheckedAt: now,
    });
  }

  return { credentials: updated, changed, unknown, checked };
}
