/**
 * lib/backup-review.ts
 *
 * Summary shown before a credential backup is downloaded (#66).
 *
 * The backup contains the private credential values (encrypted with the
 * holder's passphrase), so the holder should know what the file holds before
 * it leaves the app. This module is deliberately pure and never touches the
 * network: the summary is derived locally, and nothing about the backup's
 * contents is sent to analytics or an application API.
 */

import type { Credential } from "./credential";

export interface BackupTypeCount {
  type: string;
  count: number;
}

export interface BackupReview {
  credentialCount: number;
  /** Credential types in the backup, with counts, sorted by type. */
  types: BackupTypeCount[];
  /** New backups are always passphrase-encrypted envelopes. */
  encrypted: true;
  /** The file contains private credential values (not just public metadata). */
  containsPrivateValues: true;
  /** One paragraph safe to show verbatim in a confirmation step. */
  summary: string;
}

export function describeBackupContents(
  credentials: Credential[],
): BackupReview {
  const counts = new Map<string, number>();
  for (const credential of credentials) {
    counts.set(credential.type, (counts.get(credential.type) ?? 0) + 1);
  }
  const types = [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => a.type.localeCompare(b.type));

  const count = credentials.length;
  const typeList = types.map((t) => `${t.type} (${t.count})`).join(", ");

  return {
    credentialCount: count,
    types,
    encrypted: true,
    containsPrivateValues: true,
    summary:
      `This backup contains ${count} credential${count === 1 ? "" : "s"}` +
      `${typeList ? `: ${typeList}` : ""}. ` +
      "It is a single passphrase-encrypted JSON file that includes private " +
      "credential values, so keep it somewhere safe. It is created and saved " +
      "in this browser only — nothing is uploaded to Mithaq or any analytics " +
      "service. Without this file (or another transfer path), the credentials " +
      "cannot be recovered.",
  };
}

/** True when the backup has nothing to save. */
export function isEmptyBackup(review: BackupReview): boolean {
  return review.credentialCount === 0;
}
