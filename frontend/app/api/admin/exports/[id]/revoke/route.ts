import { NextRequest, NextResponse } from "next/server";
import { revokeExportRecord } from "@/lib/export-store";
import {
  auditLogBootstrap,
  auditLogAppend,
  auditLogPersist,
} from "@/lib/audit-log";
import { requireAdmin } from "@/app/api/_middleware";
import { bodyErrorResponse, readJsonBody } from "@/lib/request-limits";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  try {
    const { id } = await params;

    const parsed = await readJsonBody<Record<string, unknown>>(req, 8 * 1024);
    if (!parsed.ok) return bodyErrorResponse(parsed.error);
    const body = parsed.body;

    const { revokedBy } = body ?? {};
    if (!revokedBy || typeof revokedBy !== "string" || !revokedBy.trim()) {
      return NextResponse.json(
        { error: "revokedBy is required" },
        { status: 400 },
      );
    }

    const record = await revokeExportRecord(id, revokedBy.trim());
    if (!record) {
      return NextResponse.json({ error: "export not found" }, { status: 404 });
    }

    await auditLogBootstrap();
    auditLogAppend({
      timestamp: Date.now(),
      requestId: crypto.randomUUID(),
      issuer: revokedBy.trim(),
      commitment: id,
      adminAction: "revoke",
    });
    await auditLogPersist();

    return NextResponse.json({ success: true, record });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
