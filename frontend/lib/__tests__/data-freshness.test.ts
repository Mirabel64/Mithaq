import { describe, it, expect } from "vitest";
import {
  DEFAULT_STALE_AFTER_SECONDS,
  describeDataFreshness,
  formatAge,
} from "../data-freshness";

const NOW = 1_700_000_000_000;

describe("describeDataFreshness (#64)", () => {
  it("marks recent data fresh", () => {
    const view = describeDataFreshness(NOW - 30_000, NOW);
    expect(view.state).toBe("fresh");
    expect(view.ageSeconds).toBe(30);
    expect(view.canRetry).toBe(false);
  });

  it("marks old data stale and offers a retry", () => {
    const view = describeDataFreshness(
      NOW - (DEFAULT_STALE_AFTER_SECONDS + 10) * 1000,
      NOW,
    );
    expect(view.state).toBe("stale");
    expect(view.canRetry).toBe(true);
    expect(view.message).toContain("may be behind the chain");
  });

  it("never presents missing data as current or unverified", () => {
    for (const observedAt of [null, undefined, 0]) {
      const view = describeDataFreshness(observedAt, NOW);
      expect(view.state).toBe("unknown");
      expect(view.ageSeconds).toBeNull();
      expect(view.message).toContain("unknown, not unverified");
    }
  });

  it("formats ages compactly", () => {
    expect(formatAge(8)).toBe("8s");
    expect(formatAge(180)).toBe("3m");
    expect(formatAge(7_200)).toBe("2h");
  });
});
