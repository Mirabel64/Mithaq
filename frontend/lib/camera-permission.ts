/**
 * lib/camera-permission.ts
 *
 * Holder-facing guidance when camera access for QR scanning fails (#76).
 *
 * The browser exposes a small set of `getUserMedia` error names. Turning them
 * into one string loses the only part the holder can act on: whether to fix a
 * permission, fix the device, or fall back to manual entry. This module keeps
 * that decision explicit and testable, and only ever offers the manual path
 * when it is actually a viable way to continue.
 */

export interface CameraAccessView {
  /** One-line statement of what went wrong. */
  message: string;
  /** What the holder can do about it. */
  guidance: string;
  /** Whether pasting the QR content by hand will let them continue. */
  manualEntry: boolean;
}

export function describeCameraAccessError(
  errorName: string | null | undefined,
): CameraAccessView {
  switch (errorName) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return {
        message: "Camera access was denied.",
        guidance:
          "Allow camera access for this site in your browser settings (usually the camera icon in the address bar), then reopen the scanner. You can also paste the QR content below.",
        manualEntry: true,
      };
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return {
        message: "No usable camera was found on this device.",
        guidance:
          "Connect or enable a camera and try again, or paste the QR content below to continue.",
        manualEntry: true,
      };
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return {
        message: "The camera could not be started.",
        guidance:
          "Another app may be using the camera. Close it and reopen the scanner, or paste the QR content below.",
        manualEntry: true,
      };
    default:
      return {
        message: "The camera is unavailable.",
        guidance:
          "Camera scanning needs a secure (HTTPS) page and a working camera. You can paste the QR content below instead.",
        manualEntry: true,
      };
  }
}
