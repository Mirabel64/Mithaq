import { describe, it, expect } from "vitest";
import { describeCameraAccessError } from "../camera-permission";

describe("describeCameraAccessError", () => {
  it("maps a denied permission to settings guidance and a manual path", () => {
    const view = describeCameraAccessError("NotAllowedError");
    expect(view.message).toContain("denied");
    expect(view.guidance).toContain("browser settings");
    expect(view.manualEntry).toBe(true);
  });

  it("maps a missing device to device guidance", () => {
    const view = describeCameraAccessError("NotFoundError");
    expect(view.message).toContain("No usable camera");
    expect(view.manualEntry).toBe(true);
  });

  it("explains a camera that is already in use", () => {
    const view = describeCameraAccessError("NotReadableError");
    expect(view.guidance).toContain("Another app");
  });

  it("falls back to a generic, actionable message for unknown errors", () => {
    const view = describeCameraAccessError(undefined);
    expect(view.message).toBe("The camera is unavailable.");
    expect(view.guidance).toContain("paste");
    expect(view.manualEntry).toBe(true);
  });
});
