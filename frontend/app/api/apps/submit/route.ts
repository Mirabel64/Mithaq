import { NextRequest, NextResponse } from "next/server";
import { submitApp, validateSubmission } from "@/lib/apps-store";
import { bodyErrorResponse, readJsonBody } from "@/lib/request-limits";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const parsed = await readJsonBody<unknown>(req, 16 * 1024);
    if (!parsed.ok) return bodyErrorResponse(parsed.error);
    const body = parsed.body;
    const validation = validateSubmission(body);
    if (!validation.valid) {
      const firstError = Object.values(validation.errors)[0];
      return NextResponse.json({ error: firstError }, { status: 400 });
    }

    const result = await submitApp(body as Parameters<typeof submitApp>[0]);

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "Submission failed" },
      { status: 500 }
    );
  }
}
