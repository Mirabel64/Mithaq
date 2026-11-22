import type { Response } from "express";

const ERROR_CODES: Record<number, string> = {
  400: "INVALID_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  413: "PAYLOAD_TOO_LARGE",
  422: "VALIDATION_FAILED",
  429: "RATE_LIMITED",
  500: "INTERNAL_ERROR",
  502: "UPSTREAM_ERROR",
  503: "SERVICE_UNAVAILABLE",
};

export function sendApiError(
  res: Response,
  status: number,
  message: string,
  details: Record<string, unknown> = {},
): void {
  res.status(status).json({
    error: message,
    code: ERROR_CODES[status] ?? "REQUEST_FAILED",
    requestId: res.locals["requestId"],
    ...details,
  });
}

export type CursorErrorReason = "malformed" | "unsupported" | "stale";

export class CursorError extends Error {
  constructor(
    public readonly reason: CursorErrorReason,
    message: string,
  ) {
    super(message);
    this.name = "CursorError";
  }
}

const CURSOR_CODES: Record<CursorErrorReason, { status: number; code: string }> = {
  malformed: { status: 400, code: "INVALID_CURSOR" },
  unsupported: { status: 400, code: "UNSUPPORTED_CURSOR" },
  stale: { status: 410, code: "STALE_CURSOR" },
};

export function sendCursorError(res: Response, error: CursorError): void {
  const { status, code } = CURSOR_CODES[error.reason];
  res.status(status).json({
    error: error.message,
    code,
    reason: error.reason,
    requestId: res.locals["requestId"],
    hint: "Omit cursor to restart from the newest page.",
  });
}
