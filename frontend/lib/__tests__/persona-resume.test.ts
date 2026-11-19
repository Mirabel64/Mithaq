import { describe, it, expect } from "vitest";
import {
  describePersonaResumeStatus,
  resumeNeedsAction,
} from "../persona-resume";

describe("describePersonaResumeStatus", () => {
  it("treats in-flight inquiry statuses as pending", () => {
    for (const status of [
      "created",
      "pending",
      "in_progress",
      "needs_review",
    ]) {
      const view = describePersonaResumeStatus(status);
      expect(view.state).toBe("pending");
      expect(view.nextAction).toBe("wait");
    }
  });

  it("distinguishes an approval from a denial", () => {
    expect(describePersonaResumeStatus("approved").state).toBe("approved");
    expect(describePersonaResumeStatus("completed").state).toBe("approved");
    expect(describePersonaResumeStatus("declined").state).toBe("declined");
    expect(describePersonaResumeStatus("failed").state).toBe("declined");
  });

  it("reports an expired inquiry separately from a denial", () => {
    const view = describePersonaResumeStatus("expired");
    expect(view.state).toBe("expired");
    expect(view.guidance).toContain("Start a new verification");
    expect(resumeNeedsAction(view)).toBe(true);
  });

  it("does not guess when the status is unrecognised or missing", () => {
    expect(describePersonaResumeStatus("something-new").state).toBe("unknown");
    expect(describePersonaResumeStatus(null).state).toBe("unknown");
    expect(describePersonaResumeStatus(undefined).state).toBe("unknown");
  });

  it("normalises case and whitespace", () => {
    expect(describePersonaResumeStatus("  APPROVED ").state).toBe("approved");
  });

  it("keeps the provider's denial distinct from a transient outage", () => {
    expect(describePersonaResumeStatus("failed").state).toBe("declined");
    expect(describePersonaResumeStatus("unavailable").state).toBe(
      "unavailable",
    );
    expect(resumeNeedsAction(describePersonaResumeStatus("unavailable"))).toBe(
      true,
    );
  });
});
