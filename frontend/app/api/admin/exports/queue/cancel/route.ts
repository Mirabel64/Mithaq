import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/app/api/_middleware";
import { cancelQueuedJob } from "@/lib/export-scheduler";
import {
  auditLogBootstrap,
  auditLogAppend,
  auditLogPersist,
} from "@/lib/audit-log";
import { bodyErrorResponse, readJsonBody } from "@/lib/request-limits";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  try {
    const parsed = await readJsonBody<Record<string, unknown>>(req, 8 * 1024);
    if (!parsed.ok) return bodyErrorResponse(parsed.error);
    const body = parsed.body;

    const { jobId } = body ?? {};
    if (!jobId || typeof jobId !== "string" || !jobId.trim()) {
      return NextResponse.json(
        { error: "jobId is required" },
        { status: 400 },
      );
    }

    const cancelled = await cancelQueuedJob(jobId.trim());
    if (!cancelled) {
      return NextResponse.json(
        { error: "job not found in queue" },
        { status: 404 },
      );
    }

    await auditLogBootstrap();
    auditLogAppend({
      timestamp: Date.now(),
      requestId: crypto.randomUUID(),
      issuer: "admin",
      commitment: jobId.trim(),
      adminAction: "export:cancel",
    });
    await auditLogPersist();

    return NextResponse.json({ success: true, jobId: jobId.trim() });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
