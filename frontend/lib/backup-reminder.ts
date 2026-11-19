/**
 * lib/backup-reminder.ts
 *
 * Reminder copy for destructive holder actions (#65).
 *
 * Credentials live only in this browser. Anything that removes them — wiping
 * local data, clearing credentials, moving to another device — is
 * unrecoverable unless the holder exported a backup or transferred the
 * credential, and the service cannot restore it for them. This module keeps
 * that fact explicit at the moment it matters.
 */

export type DestructiveMoment =
  | "wipe-all-data"
  | "clear-credentials"
  | "remove-expired"
  | "change-device";

export interface BackupReminder {
  /** Whether the reminder is relevant (there is something to lose). */
  relevant: boolean;
  headline: string;
  /** Explanation of why a backup is the only recovery path. */
  detail: string;
}

const HEADLINES: Record<DestructiveMoment, string> = {
  "wipe-all-data": "Export a backup before wiping",
  "clear-credentials": "Export a backup before clearing credentials",
  "remove-expired": "Export a backup before removing credentials",
  "change-device": "Export a backup before switching devices",
};

export function backupReminderFor(
  moment: DestructiveMoment,
  options: { hasCredentials: boolean },
): BackupReminder {
  return {
    relevant: options.hasCredentials,
    headline: HEADLINES[moment],
    detail:
      "Backups are controlled entirely by you: the file is created in this " +
      "browser and is never uploaded. Mithaq cannot recover credentials that " +
      "were not exported, and removed credentials cannot be restored by the " +
      "issuer.",
  };
}
