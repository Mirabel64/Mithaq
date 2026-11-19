"use client";

/**
 * AccountSwitchBanner — confirmation for a wallet account change (#61).
 *
 * When the wallet reports a different account than the one the current flow
 * was prepared for, the app keeps the old account active and asks first. No
 * wallet-authorized action continues against an account the holder did not
 * confirm.
 */

import { IconAlertTriangle } from "@tabler/icons-react";
import { useWallet } from "@/lib/wallet-context";
import { accountSwitchPrompt } from "@/lib/wallet-session";

export function AccountSwitchBanner() {
  const {
    pendingAccountSwitch,
    confirmAccountSwitch,
    cancelAccountSwitch,
  } = useWallet();

  if (!pendingAccountSwitch) return null;

  return (
    <div
      role="alert"
      className="row"
      style={{
        gap: "0.75rem",
        padding: "0.75rem 1.5rem",
        borderBottom: "1px solid rgba(245, 158, 11, 0.4)",
        background: "rgba(245, 158, 11, 0.1)",
        fontSize: "0.8125rem",
        justifyContent: "center",
        flexWrap: "wrap",
      }}
    >
      <IconAlertTriangle size={16} style={{ color: "#f59e0b", flexShrink: 0 }} />
      <span>{accountSwitchPrompt(pendingAccountSwitch.from, pendingAccountSwitch.to)}</span>
      <button type="button" className="btn btn-primary btn-sm" onClick={confirmAccountSwitch}>
        Use new account
      </button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={cancelAccountSwitch}>
        Keep previous account
      </button>
    </div>
  );
}
