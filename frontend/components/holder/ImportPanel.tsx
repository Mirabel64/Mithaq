"use client";

import { useState } from "react";
import { saveCredentials, type Credential } from "@/lib/credential";
import {
  parseCredentialDocumentReport,
  type CredentialImportReport,
} from "@/lib/credential-json";

/**
 * Import review (#67).
 *
 * A JSON document is validated record by record first: invalid records are
 * listed with the reason and position, and only the valid ones are saved — and
 * only after the holder has seen the summary. Reasons come from the credential
 * parser, which names the offending field but never its value, so secrets in
 * the file do not appear in the UI.
 */
export function ImportPanel({
  onImported,
  onCancel,
}: {
  onImported: () => void;
  onCancel: () => void;
}) {
  const [json, setJson] = useState("");
  const [error, setError] = useState("");
  const [report, setReport] = useState<CredentialImportReport | null>(null);
  const [saving, setSaving] = useState(false);

  function review() {
    setError("");
    setReport(null);
    try {
      const next = parseCredentialDocumentReport(json);
      if (
        next.document === "single" &&
        next.valid.length === 1 &&
        next.invalid.length === 0
      ) {
        // The common case: one valid credential, no review step needed.
        setReport(next);
        void save(next.valid);
        return;
      }
      setReport(next);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function save(creds: Credential[]) {
    if (creds.length === 0) return;
    setSaving(true);
    try {
      await saveCredentials(creds);
      onImported();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  return (
    <div className="card reveal">
      <span className="eyebrow">Import credential</span>
      <textarea
        rows={5}
        placeholder='{"type":"kyc","commitment":"0x...", ...}'
        value={json}
        onChange={(e) => {
          setJson(e.target.value);
          setReport(null);
          setError("");
        }}
        style={{ marginTop: "0.75rem" }}
      />
      {error && (
        <p
          style={{
            color: "var(--danger)",
            fontSize: "0.8125rem",
            marginTop: "0.5rem",
          }}
        >
          {error}
        </p>
      )}

      {report && (
        <div
          role="status"
          aria-live="polite"
          style={{
            marginTop: "0.75rem",
            padding: "0.7rem 0.85rem",
            borderRadius: "var(--radius)",
            border: "1px solid var(--border)",
            fontSize: "0.8125rem",
            lineHeight: 1.6,
          }}
        >
          <p style={{ margin: 0 }}>
            {report.valid.length} of{" "}
            {report.valid.length + report.invalid.length} record
            {report.valid.length + report.invalid.length === 1 ? "" : "s"}{" "}
            passed validation.
          </p>
          {report.invalid.length > 0 && (
            <ul
              style={{
                margin: "0.4rem 0 0",
                paddingLeft: "1.1rem",
                color: "var(--danger)",
              }}
            >
              {report.invalid.map((issue) => (
                <li key={issue.index}>
                  Record {issue.index + 1}: {issue.reason}
                </li>
              ))}
            </ul>
          )}
          {report.valid.length === 0 && (
            <p className="faint" style={{ margin: "0.4rem 0 0" }}>
              Nothing was saved. Fix these records and paste the file again.
            </p>
          )}
        </div>
      )}

      <div className="row" style={{ marginTop: "1rem", gap: "0.6rem" }}>
        {report && report.valid.length > 0 ? (
          <button
            className="btn btn-primary btn-sm"
            onClick={() => save(report.valid)}
            disabled={saving}
          >
            {saving
              ? "Saving…"
              : `Save ${report.valid.length} valid credential${report.valid.length === 1 ? "" : "s"}`}
          </button>
        ) : (
          <button
            className="btn btn-primary btn-sm"
            onClick={review}
            disabled={!json.trim() || saving}
          >
            Review import
          </button>
        )}
        <button
          className="btn btn-ghost btn-sm"
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
