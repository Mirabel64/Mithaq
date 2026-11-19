"use client";

// Global wallet connection state. Lives in the root layout so it survives client
// navigation between pages (the layout never unmounts), and restores from
// localStorage on a full page reload — so you connect once, not per page.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import {
  connect as kitConnect,
  restore as kitRestore,
  getNetworkOk,
  WalletConnectError,
} from "./wallet";
import {
  classifyWalletChange,
  requiresAccountConfirmation,
} from "./wallet-session";

const STORAGE_KEY = "mithaq:wallet-id";
const NETWORK_POLL_MS = 4_000;

export interface PendingAccountSwitch {
  from: string;
  to: string;
  walletId: string;
}

interface WalletState {
  address: string;
  connecting: boolean;
  error: WalletConnectError | null;
  networkMismatch: boolean;
  /**
   * Set when the wallet reports a different account than the one the current
   * flow was prepared for (#61). `address` is deliberately left unchanged
   * until the holder confirms the switch.
   */
  pendingAccountSwitch: PendingAccountSwitch | null;
  confirmAccountSwitch: () => void;
  cancelAccountSwitch: () => void;
  connect: () => Promise<void>;
  disconnect: () => void;
}

const WalletContext = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<WalletConnectError | null>(null);
  const [networkMismatch, setNetworkMismatch] = useState(false);
  const [pendingAccountSwitch, setPendingAccountSwitch] =
    useState<PendingAccountSwitch | null>(null);

  // Restore a prior connection on mount (full reload).
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(STORAGE_KEY);
    } catch {
      // storage unavailable (private mode / blocked) — skip restore
      return;
    }
    if (!saved) return;
    kitRestore(saved)
      .then(setAddress)
      .catch(() => {
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch {
          // storage unavailable — nothing to remove
        }
      });
  }, []);

  // Poll the wallet's live network while connected, so a network switch made
  // after connecting is caught without requiring a reconnect.
  useEffect(() => {
    if (!address) {
      setNetworkMismatch(false);
      return;
    }
    let cancelled = false;
    const check = () => {
      getNetworkOk().then((ok) => {
        if (!cancelled) setNetworkMismatch(!ok);
      });
    };
    check();
    const id = setInterval(check, NETWORK_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [address]);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const { address: nextAddress, walletId } = await kitConnect();

      // Never swap the active account silently during a flow (#61): keep the
      // current address and ask the holder to confirm the new one.
      if (requiresAccountConfirmation(classifyWalletChange(address, nextAddress))) {
        setPendingAccountSwitch({ from: address, to: nextAddress, walletId });
        return;
      }

      setAddress(nextAddress);
      localStorage.setItem(STORAGE_KEY, walletId);
    } catch (e) {
      const err = e instanceof WalletConnectError
        ? e
        : new WalletConnectError("unknown", (e as Error).message ?? "Something went wrong");
      // Surface every kind — including "dismissed". Cancellations are rendered
      // as a benign note (not a hard error) via WalletErrorInfo.benign, per
      // the per-kind error mapping requirement.
      setError(err);
    } finally {
      setConnecting(false);
    }
  }, [address]);

  const confirmAccountSwitch = useCallback(() => {
    if (!pendingAccountSwitch) return;
    setAddress(pendingAccountSwitch.to);
    try {
      localStorage.setItem(STORAGE_KEY, pendingAccountSwitch.walletId);
    } catch {
      // storage unavailable — the in-memory account is still switched
    }
    setPendingAccountSwitch(null);
  }, [pendingAccountSwitch]);

  const cancelAccountSwitch = useCallback(() => {
    setPendingAccountSwitch(null);
  }, []);

  const disconnect = useCallback(() => {
    setAddress("");
    setError(null);
    setPendingAccountSwitch(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // storage unavailable — nothing to remove
    }
  }, []);

  return (
    <WalletContext.Provider
      value={{
        address,
        connecting,
        error,
        networkMismatch,
        pendingAccountSwitch,
        confirmAccountSwitch,
        cancelAccountSwitch,
        connect,
        disconnect,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
}

export function usePreviewMode(): boolean {
  const { address } = useWallet();
  return !address;
}
