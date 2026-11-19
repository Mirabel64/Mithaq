import { describe, it, expect } from "vitest";
import { describeTransactionFailure } from "../transaction-failure";

describe("describeTransactionFailure (#62)", () => {
  it("explains a fee the wallet cannot cover", () => {
    const failure = describeTransactionFailure(
      "Transaction failed: tx_insufficient_balance",
    );
    expect(failure.category).toBe("fee");
    expect(failure.friendly).toContain("Add XLM");
    expect(failure.retryable).toBe(true);
  });

  it("explains a resource limit with a concrete next step", () => {
    const failure = describeTransactionFailure(
      "HostError: resource limit exceeded (cpu instructions)",
    );
    expect(failure.category).toBe("resource");
    expect(failure.friendly).toContain("Batch fewer proofs");
  });

  it("separates an expired simulation from an invalid one", () => {
    expect(describeTransactionFailure("simulation expired").category).toBe(
      "expired",
    );
    expect(describeTransactionFailure("HostError: trap").category).toBe(
      "simulation",
    );
  });

  it("keeps the raw message for support", () => {
    const raw = "HostError: resource limit exceeded";
    expect(describeTransactionFailure(raw).technical).toBe(raw);
  });

  it("does not invent guidance for an unrecognised message", () => {
    const failure = describeTransactionFailure("something odd happened");
    expect(failure.category).toBe("unknown");
    expect(failure.friendly).toBe("something odd happened");
    expect(failure.retryable).toBe(false);
  });
});
