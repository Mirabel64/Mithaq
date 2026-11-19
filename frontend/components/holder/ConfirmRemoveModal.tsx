"use client";

import { useState } from "react";

/**
 * ConfirmRemoveModal — simple destructive-action confirmation dialog used by
 * HolderPageClient for bulk credential removal.
 */
export function ConfirmRemoveModal({
  count,
  activeProofCount,
  label,
  onConfirm,
  onCancel,
}: {
  count: number;
  /** How many of the selected credentials currently have a live on-chain proof. */
  activeProofCount: number;
  label: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const requiresAck = activeProofCount > 0;

  return (
    <div
      className="modal-backdrop"
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0,0,0,0.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
    >
      <div
        className="modal-card"
        style={{
          background: "#18181b",
          border: "1px solid #27272a",
          borderRadius: "12px",
          padding: "1.5rem",
          maxWidth: "420px",
          width: "90%",
        }}
      >
        <h3 style={{ marginTop: 0, fontSize: "1.2rem" }}>{label}</h3>
        <p className="faint" style={{ fontSize: "0.9rem", margin: "1rem 0" }}>
          This will permanently remove {count} credential{count > 1 ? "s" : ""} from
          your browser&apos;s local storage.
        </p>
        {requiresAck && (
          <p style={{ fontSize: "0.85rem", margin: "0 0 1rem", color: "#fbbf24" }}>
            {activeProofCount} of {count} selected credential{activeProofCount > 1 ? "s" : ""}{" "}
            {activeProofCount > 1 ? "have" : "has"} an active on-chain proof. Removing the local
            record does not revoke that proof — it stays verifiable on-chain until it expires.
          </p>
        )}
        {requiresAck && (
          <label className="row" style={{ gap: "0.5rem", alignItems: "flex-start", fontSize: "0.85rem", marginBottom: "1rem" }}>
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
            />
            I understand this won&apos;t revoke the on-chain proof.
          </label>
        )}
        <div className="row" style={{ justifyContent: "flex-end", gap: "0.75rem" }}>
          <button className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn btn-danger"
            style={{ backgroundColor: "#dc2626", color: "#fff" }}
            disabled={requiresAck && !acknowledged}
            onClick={onConfirm}
          >
            Confirm Delete
          </button>
        </div>
      </div>
    </div>
  );
}
