/**
 * Admin audit-log viewer — Server Component.
 *
 * Search by issuer / request ID / admin action, filter by action and date
 * range (query-string state), and open any entry's detail inline. Entries are
 * PII-free by construction (see lib/audit-log.ts); only the whitelisted audit
 * fields are rendered. Gated by the same admin check as the issuance queue.
 */

import { isAdminPageAuthorized } from "@/lib/admin-page-auth";
import { auditLogBootstrap, auditLogEntries } from "@/lib/audit-log";

export const dynamic = "force-dynamic";

const MAX_ROWS = 200;

// Audit timestamps are unix seconds; tolerate milliseconds.
const toMs = (t: number) => (t < 1e12 ? t * 1000 : t);

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: { q?: string; action?: string; from?: string; to?: string };
}) {
  if (!isAdminPageAuthorized()) {
    return <p>Admin sign-in required. Sign in from the issuance queue page.</p>;
  }

  await auditLogBootstrap();
  const q = (searchParams.q ?? "").trim().toLowerCase();
  const action = (searchParams.action ?? "").trim().toLowerCase();
  const fromMs = searchParams.from ? Date.parse(searchParams.from) : NaN;
  const untilMs = searchParams.to ? Date.parse(searchParams.to) + 86_400_000 : NaN;

  const entries = auditLogEntries()
    .filter((e) => !q || [e.issuer, e.requestId, e.adminAction ?? ""].some((v) => v.toLowerCase().includes(q)))
    .filter((e) => !action || (e.adminAction ?? "").toLowerCase().includes(action))
    .filter((e) => Number.isNaN(fromMs) || toMs(e.timestamp) >= fromMs)
    .filter((e) => Number.isNaN(untilMs) || toMs(e.timestamp) < untilMs)
    .reverse();
  const shown = entries.slice(0, MAX_ROWS);

  return (
    <section aria-labelledby="audit-heading">
      <h2 id="audit-heading" style={{ fontSize: "1.1rem", marginBottom: "1rem" }}>
        Audit Log
      </h2>
      <form method="get" style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        <input name="q" placeholder="Issuer / request ID" aria-label="Search" defaultValue={searchParams.q ?? ""} />
        <input name="action" placeholder="Admin action" aria-label="Action" defaultValue={searchParams.action ?? ""} />
        <input name="from" type="date" aria-label="From date" defaultValue={searchParams.from ?? ""} />
        <input name="to" type="date" aria-label="To date" defaultValue={searchParams.to ?? ""} />
        <button type="submit">Search</button>
      </form>
      <p role="status" style={{ color: "var(--muted)" }}>
        {entries.length} matching {entries.length === 1 ? "entry" : "entries"}
        {entries.length > shown.length ? ` (showing latest ${MAX_ROWS})` : ""}
      </p>
      <ul style={{ listStyle: "none", padding: 0, color: "var(--text)" }}>
        {shown.map((e) => (
          <li key={e.index} style={{ borderTop: "1px solid var(--border)", padding: "0.5rem 0" }}>
            <details>
              <summary>
                #{e.index} · {new Date(toMs(e.timestamp)).toISOString()} · {e.issuer}
                {e.adminAction ? ` · ${e.adminAction}` : ""}
              </summary>
              <dl style={{ fontFamily: "monospace", wordBreak: "break-all", margin: "0.5rem 0 0 1rem" }}>
                <dt>Request ID</dt>
                <dd>{e.requestId}</dd>
                <dt>Issuer</dt>
                <dd>{e.issuer}</dd>
                <dt>Admin action</dt>
                <dd>{e.adminAction ?? "—"}</dd>
                <dt>Commitment</dt>
                <dd>{e.commitment}</dd>
                <dt>Previous hash</dt>
                <dd>{e.prevHash}</dd>
                <dt>Hash</dt>
                <dd>{e.hash}</dd>
              </dl>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}
