"use client";

import { useState } from "react";
import {
  IconExternalLink,
  IconTrash,
  IconHistory,
  IconInfoCircle,
} from "@tabler/icons-react";
import { Badge } from "@/components/Badge";
import { Timeline } from "@/components/Timeline";
import { truncateHash } from "@/lib/format";
import { EXPLORER_TX } from "@/lib/stellar";
import { proofSubmissionConfigured } from "@/lib/config";
import { useProofTimeline } from "@/lib/useProofTimeline";
import {
  proofStatus,
  isExpiringSoon,
  daysRemaining,
  credIsExpired,
  credExpiryTimestamp,
  credExpiryWithinDays,
  formatExpiryDate,
} from "@/lib/proof-helpers";
import { describeDataFreshness } from "@/lib/data-freshness";
import { saveCredential, type Credential } from "@/lib/credential";
import { checkIssuerStatus } from "@/lib/issuer-registry";

export interface BatchSelection {
  checked: boolean;
  /** Why this card cannot be added to the batch, or null when it can. */
  blockedReason: string | null;
  onToggle: () => void;
}

export function CredCard({
  c,
  address,
  onProve,
  onRemove,
  onInspect,
  isPreview,
  selection,
  onStatusUpdated,
}: {
  c: Credential;
  address: string;
  onProve: () => void;
  onRemove: () => void;
  onInspect?: () => void;
  isPreview?: boolean;
  /** Called after a manual status re-check persisted a new result. */
  onStatusUpdated?: () => void;
  /** When present, renders a batch-selection checkbox. Omit for non-batchable cards. */
  selection?: BatchSelection;
}) {
  const status = proofStatus(c);
  const { events } = useProofTimeline(c);
  const [showHistory, setShowHistory] = useState(false);
  const [rechecking, setRechecking] = useState(false);

  // Stale data must be visible (#64): `issuerStatusCheckedAt` is the last
  // successful registry read, so an old value means the badge above may be
  // behind the chain. `unknown` (never checked) is not treated as stale here.
  const freshness = describeDataFreshness(
    c.issuerStatusCheckedAt ? c.issuerStatusCheckedAt * 1000 : null,
  );

  async function recheckStatus() {
    if (!address || rechecking) return;
    setRechecking(true);
    try {
      let issuerStatus: Credential["issuerStatus"] = "unknown";
      if (c.issuerId && c.issuerPubX && c.issuerPubY) {
        try {
          issuerStatus = await checkIssuerStatus(
            c.issuerId,
            c.type,
            c.issuerPubX,
            c.issuerPubY,
            address,
          );
        } catch {
          // A failed read is unknown, never a revocation.
          issuerStatus = "unknown";
        }
      }
      await saveCredential({
        ...c,
        issuerStatus,
        issuerStatusCheckedAt: Math.floor(Date.now() / 1000),
      });
      onStatusUpdated?.();
    } finally {
      setRechecking(false);
    }
  }

  return (
    <div className="card cred-card">
      <div className="cred-card__top">
        {/* left: credential info */}
        <div className="cred-card__info">
          <div className="row" style={{ gap: "0.5rem", flexWrap: "wrap" }}>
            <span className="cred-card__title">{c.title}</span>
            <span className="mono faint" style={{ fontSize: "0.7rem" }}>{c.claim}</span>
          </div>
          <div className="cred-card__meta">
            <div>
              {c.issuer} &middot; <span>{truncateHash(c.commitment)}</span>
              {status === "proved" && (
                <>
                  {" "}
                  <span className="cred-card__expires">
                    expires in {daysRemaining(c)}d
                  </span>
                  {c.provedTxHash && (
                    <>
                      {" "}
                      <a
                        href={EXPLORER_TX(c.provedTxHash)}
                        target="_blank"
                        rel="noreferrer"
                        className="cred-card__tx-link"
                      >
                        {c.provedTxHash.slice(0, 6)}&hellip;<IconExternalLink size={10} />
                      </a>
                    </>
                  )}
                </>
              )}
              {status === "expired" && (
                <> <span className="cred-card__expired">expired</span></>
              )}
            </div>
            <div className="cred-card__expiry">
              {credIsExpired(c) ? (
                <span className="cred-card__expired-label">Expired</span>
              ) : (
                <span className={credExpiryWithinDays(c, 30) ? "cred-card__expiring" : "faint"}>
                  Expires {formatExpiryDate(credExpiryTimestamp(c))}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* right: badges + buttons */}
        <div className="card-actions">
          {selection && (
            <input
              type="checkbox"
              checked={selection.checked}
              disabled={!selection.checked && selection.blockedReason !== null}
              title={selection.blockedReason ?? undefined}
              onChange={selection.onToggle}
              aria-label={`Select ${c.title} for batch`}
              style={{ cursor: selection.blockedReason && !selection.checked ? "not-allowed" : "pointer" }}
            />
          )}
          {isPreview && <Badge variant="pending">Preview</Badge>}
          <Badge variant="verified" dot={false}>Held</Badge>
          {status === "proved" && !isExpiringSoon(c) && (
            <Badge variant="verified" dot={false}>On-chain</Badge>
          )}
          {status === "proved" && isExpiringSoon(c) && (
            <Badge variant="pending" dot={true}>Expiring in {daysRemaining(c)}d</Badge>
          )}
          {status === "expired" && (
            <Badge variant="denied" dot={true}>Proof Expired</Badge>
          )}
          {onInspect && (
            <button
              className="btn btn-ghost btn-sm"
              title="View details"
              onClick={onInspect}
            >
              <IconInfoCircle size={13} />
            </button>
          )}
          <button
            className={`btn btn-sm ${status === "proved" ? "btn-secondary" : "btn-primary"}`}
            disabled={!address || credIsExpired(c) || !proofSubmissionConfigured()}
            title={
              !address
                ? "Connect a wallet first"
                : credIsExpired(c)
                  ? "This credential has expired"
                  : !proofSubmissionConfigured()
                    ? "App not configured — NEXT_PUBLIC_PROOF_REGISTRY_ID missing"
                    : undefined
            }
            onClick={onProve}
          >
            {status === "proved" ? "Re-prove" :
             status === "expired" ? "Re-prove" :
                                    "Generate proof"}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            title="History"
            onClick={() => setShowHistory(!showHistory)}
          >
            <IconHistory size={13} />
          </button>
          <button
            className="btn btn-ghost btn-sm"
            title="Remove"
            onClick={onRemove}
          >
            <IconTrash size={13} />
          </button>
        </div>
      </div>

      {freshness.state === "stale" && (
        <div
          role="status"
          className="row"
          style={{ gap: "0.5rem", margin: "0.4rem 0 0", flexWrap: "wrap", alignItems: "center" }}
        >
          <span className="faint" style={{ fontSize: "0.72rem" }}>
            {freshness.message}
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={recheckStatus}
            disabled={rechecking || !address}
            style={{ fontSize: "0.72rem", padding: "0.1rem 0.4rem" }}
          >
            {rechecking ? "Re-checking…" : "Re-check now"}
          </button>
        </div>
      )}

      {showHistory && (
        <Timeline events={events} />
      )}
    </div>
  );
}
