/**
 * lib/wallet-session.ts
 *
 * Account-change semantics for the wallet session (#61).
 *
 * A wallet can return a different account than the one a flow started with
 * (the holder switched accounts in the extension, or restored a different
 * wallet). Continuing silently would sign or prove against stale state, so the
 * change is classified here and the UI asks the holder to confirm it first.
 */

export type WalletChange =
  | "unchanged"
  | "connected"
  | "disconnected"
  | "account-changed";

/**
 * Classify the transition from the account a flow is using to the account the
 * wallet now reports.
 */
export function classifyWalletChange(
  previous: string | null | undefined,
  next: string | null | undefined,
): WalletChange {
  const before = (previous ?? "").trim();
  const after = (next ?? "").trim();

  if (!before && !after) return "unchanged";
  if (!before && after) return "connected";
  if (before && !after) return "disconnected";
  if (before === after) return "unchanged";
  return "account-changed";
}

/** True when the holder must confirm before any wallet-authorized action. */
export function requiresAccountConfirmation(change: WalletChange): boolean {
  return change === "account-changed";
}

/** Short, non-alarming prompt naming both accounts. */
export function accountSwitchPrompt(from: string, to: string): string {
  return `Your wallet is now on a different account (${shorten(from)} → ${shorten(to)}). Confirm the new account before continuing — anything you started was prepared for the previous one.`;
}

function shorten(address: string): string {
  if (address.length <= 14) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
