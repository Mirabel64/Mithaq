/**
 * lib/data-freshness.ts
 *
 * Turns "when was this data last confirmed?" into an honest UI state (#64).
 *
 * On-chain reads and indexer-backed views can be behind. Presenting an old
 * answer as if it were current — or a timeout as "active" — is the failure
 * this module exists to prevent: anything older than the threshold is
 * `stale`, and anything that was never confirmed is `unknown`.
 */

export type FreshnessState = "fresh" | "stale" | "unknown";

export interface FreshnessView {
  state: FreshnessState;
  /** Age in whole seconds, or null when the data was never confirmed. */
  ageSeconds: number | null;
  message: string;
  /** Whether an explicit retry/chain re-read is worth offering. */
  canRetry: boolean;
}

/** Default staleness threshold: two minutes is well past a normal read. */
export const DEFAULT_STALE_AFTER_SECONDS = 120;

/**
 * @param observedAt epoch milliseconds of the last successful answer, or
 *   null/0 when there has never been one.
 * @param now epoch milliseconds (injectable for tests).
 */
export function describeDataFreshness(
  observedAt: number | null | undefined,
  now: number = Date.now(),
  staleAfterSeconds: number = DEFAULT_STALE_AFTER_SECONDS,
): FreshnessView {
  if (!observedAt || !Number.isFinite(observedAt) || observedAt <= 0) {
    return {
      state: "unknown",
      ageSeconds: null,
      message:
        "This status has not been confirmed on-chain yet. It is unknown, not unverified.",
      canRetry: true,
    };
  }

  const ageSeconds = Math.max(0, Math.floor((now - observedAt) / 1000));
  if (ageSeconds > staleAfterSeconds) {
    return {
      state: "stale",
      ageSeconds,
      message: `This status was last confirmed ${formatAge(ageSeconds)} ago and may be behind the chain.`,
      canRetry: true,
    };
  }

  return {
    state: "fresh",
    ageSeconds,
    message: `Status confirmed ${formatAge(ageSeconds)} ago.`,
    canRetry: false,
  };
}

/** Compact age, e.g. "8s", "3m", "2h". */
export function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
}
