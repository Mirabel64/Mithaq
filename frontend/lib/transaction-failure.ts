/**
 * lib/transaction-failure.ts
 *
 * User-facing guidance for Soroban simulation, resource, and fee failures
 * (#62).
 *
 * `parseContractError` already maps contract error codes. This module covers
 * the failures that happen *around* the contract — a fee the wallet cannot
 * cover, a resource limit, a simulation that expired — where the raw message
 * tells the holder nothing actionable. The raw text is always retained so it
 * can be attached to support requests.
 */

export type FailureCategory =
  | "fee"
  | "resource"
  | "expired"
  | "simulation"
  | "network"
  | "unknown";

export interface TransactionFailure {
  category: FailureCategory;
  /** Actionable guidance, safe to show next to the failed action. */
  friendly: string;
  /** Whether retrying the same action could plausibly succeed. */
  retryable: boolean;
  /** Safe technical detail (the original message) for support. */
  technical: string;
}

interface Pattern {
  category: FailureCategory;
  matches: RegExp;
  friendly: string;
  retryable: boolean;
}

const PATTERNS: Pattern[] = [
  {
    category: "fee",
    matches:
      /insufficient (fee|balance)|tx_?insufficient_?balance|fee (too|would exceed)|not enough (xlm|lumens)|balance is not sufficient/i,
    friendly:
      "Your wallet balance is too low to cover the network fee. Add XLM to the account, then submit again.",
    retryable: true,
  },
  {
    category: "resource",
    matches:
      /resource (limit|exhausted|error)|exceeded (the )?(maximum|limit)|cpu (limit|budget)|mem (limit|budget)|instructions exceeded/i,
    friendly:
      "The transaction needed more resources than the network allows in one operation. Batch fewer proofs, or retry with a fresh simulation.",
    retryable: true,
  },
  {
    category: "expired",
    matches: /expired|tx_?too_?late|timebounds|ledger bounds|deadline exceeded/i,
    friendly:
      "The transaction's validity window passed before it was submitted. Rebuild and submit it again.",
    retryable: true,
  },
  {
    category: "simulation",
    matches: /simulation failed|hosterror|wasm trap|invalid action|diagnostic events/i,
    friendly:
      "The network could not simulate this transaction, so it was not submitted. Nothing was charged — check the inputs and try again.",
    retryable: true,
  },
  {
    category: "network",
    matches:
      /failed to fetch|network ?error|econnrefused|etimedout|timed out|timeout|service unavailable|bad gateway|too many requests/i,
    friendly:
      "The Stellar network could not be reached, so the transaction's outcome is unknown. Check the explorer before retrying.",
    retryable: true,
  },
];

export function describeTransactionFailure(raw: string): TransactionFailure {
  const text = (raw ?? "").trim();
  for (const pattern of PATTERNS) {
    if (pattern.matches.test(text)) {
      return {
        category: pattern.category,
        friendly: pattern.friendly,
        retryable: pattern.retryable,
        technical: text,
      };
    }
  }
  return {
    category: "unknown",
    friendly: text || "The transaction failed for an unknown reason.",
    retryable: false,
    technical: text,
  };
}
