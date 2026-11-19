"use client";

import { useState } from "react";
import { parseCredential, type Credential } from "@/lib/credential";

export function ImportPanel({
  existingCreds,
  onImport,
  onCancel,
}: {
  existingCreds: Credential[];
  onImport: (c: Credential) => void;
  onCancel: () => void;
}) {
  const [json, setJson] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState<Credential | null>(null);

  function onAdd() {
    try {
      const parsed = parseCredential(json);
      const duplicate = existingCreds.find(
        (c) => c.type === parsed.type && c.commitment === parsed.commitment,
      );
      if (duplicate) {
        setError("");
        setPending(parsed);
        return;
      }
      onImport(parsed);
    } catch (e) {
      setError((e as Error).message);
      setPending(null);
    }
  }

  function onConfirmReplace() {
    if (pending) onImport(pending);
    setPending(null);
  }

  return (
    <div className="card reveal">
      <span className="eyebrow">Import credential</span>
      <textarea
        rows={5}
        placeholder='{"type":"kyc","commitment":"0x...", ...}'
        value={json}
        onChange={(e) => setJson(e.target.value)}
        style={{ marginTop: "0.75rem" }}
      />
      {error && (
        <p style={{ color: "var(--danger)", fontSize: "0.8125rem", marginTop: "0.5rem" }}>
          {error}
        </p>
      )}
      {pending && (
        <p style={{ color: "var(--warn, #eab308)", fontSize: "0.8125rem", marginTop: "0.5rem" }}>
          A local credential with this commitment already exists for &ldquo;{pending.type}&rdquo;
          — importing will replace it. Unrelated credentials are kept.
        </p>
      )}
      <div className="row" style={{ marginTop: "1rem", gap: "0.6rem" }}>
        {pending ? (
          <>
            <button className="btn btn-primary btn-sm" onClick={onConfirmReplace}>
              Replace existing credential
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setPending(null)}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <button className="btn btn-primary btn-sm" onClick={onAdd} disabled={!json.trim()}>
              Add credential
            </button>
            <button className="btn btn-ghost btn-sm" onClick={onCancel}>
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  );
}
