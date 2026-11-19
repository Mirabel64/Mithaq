"use client";

/**
 * CredentialStatusRefresh — holder-triggered on-chain status check (#63).
 *
 * Requests an immediate issuer/proof status read instead of waiting for the
 * background five-minute check, shows a visible busy state, and says plainly
 * when the result is unknown (a failed read) rather than implying the
 * credential is active.
 */

import { useState } from "react";
import { IconLoader2, IconRefresh } from "@tabler/icons-react";
import {
  loadCredentials,
  saveCredentials,
  type Credential,
} from "@/lib/credential";
import { refreshCredentialStatuses } from "@/lib/issuer-status-refresh";

export function CredentialStatusRefresh({
  address,
  onRefreshed,
}: {
  address: string | null | undefined;
  onRefreshed: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  async function refresh() {
    if (!address || busy) return;
    setBusy(true);
    setNote("");
    try {
      const stored: Credential[] = await loadCredentials();
      const result = await refreshCredentialStatuses(stored, address);

      // One storage write for the whole refreshed set, so a partial loop
      // cannot leave half the credentials with a new timestamp.
      await saveCredentials(result.credentials);

      onRefreshed();
      setNote(
        result.checked === 0
          ? "No credentials have issuer details to check yet."
          : result.unknown > 0
            ? `Checked ${result.checked}; ${result.unknown} could not be read (status unknown, not revoked).`
            : `Checked ${result.checked} credential${result.checked === 1 ? "" : "s"}.`,
      );
    } catch {
      setNote("Could not refresh status right now — nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="row"
      style={{ gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}
    >
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={refresh}
        disabled={!address || busy}
        title={
          address
            ? "Check issuer and proof status on-chain now"
            : "Connect a wallet to read on-chain status"
        }
      >
        {busy ? (
          <IconLoader2 size={14} className="spin" />
        ) : (
          <IconRefresh size={14} />
        )}
        {busy ? "Refreshing status…" : "Refresh status"}
      </button>
      {note && (
        <span className="faint" role="status" style={{ fontSize: "0.75rem" }}>
          {note}
        </span>
      )}
    </div>
  );
}
