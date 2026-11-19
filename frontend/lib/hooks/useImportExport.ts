"use client";

/**
 * useImportExport — import credential JSON and export backup files.
 *
 * Encapsulates the download-backup logic and credential parsing so the
 * holder page stays focused on orchestration.
 */

import { useCallback } from "react";
import {
  exportCredentials,
  parseCredential,
  type Credential,
} from "../credential";
import { describeBackupContents } from "../backup-review";

export function useImportExport() {
  /**
   * Downloads every locally stored credential as a JSON backup file.
   *
   * Before the file is created, the holder is shown what it contains and that
   * it is encrypted (#66). The summary is derived locally from the exported
   * records and is never sent to analytics or an application API.
   */
  const downloadBackup = useCallback(async () => {
    const json = await exportCredentials();
    if (!json || json === "[]") return;

    const review = describeBackupContents(JSON.parse(json) as Credential[]);
    if (!window.confirm(review.summary)) return;

    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mithaq-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  /** Parse a JSON string into a Credential, throwing on invalid input. */
  const parseImport = useCallback((json: string): Credential => {
    return parseCredential(json);
  }, []);

  return {
    downloadBackup,
    parseImport,
  };
}
