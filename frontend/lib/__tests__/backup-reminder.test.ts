import { describe, it, expect } from "vitest";
import { backupReminderFor } from "../backup-reminder";

describe("backupReminderFor (#65)", () => {
  it("explains that the service cannot recover credentials", () => {
    const reminder = backupReminderFor("wipe-all-data", { hasCredentials: true });
    expect(reminder.relevant).toBe(true);
    expect(reminder.headline).toMatch(/Export a backup/);
    expect(reminder.detail).toContain("cannot recover");
    expect(reminder.detail).toContain("controlled");
  });

  it("names the action in the headline", () => {
    expect(
      backupReminderFor("change-device", { hasCredentials: true }).headline,
    ).toMatch(/switching devices/);
  });

  it("stays out of the way when there is nothing to lose", () => {
    expect(
      backupReminderFor("wipe-all-data", { hasCredentials: false }).relevant,
    ).toBe(false);
  });
});
