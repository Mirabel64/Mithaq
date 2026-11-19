import { describe, it, expect } from "vitest";
import {
  accountSwitchPrompt,
  classifyWalletChange,
  requiresAccountConfirmation,
} from "../wallet-session";

const A = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const B = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBHF2";

describe("classifyWalletChange (#61)", () => {
  it("separates a first connection from an account change", () => {
    expect(classifyWalletChange("", A)).toBe("connected");
    expect(classifyWalletChange(A, B)).toBe("account-changed");
    expect(classifyWalletChange(A, A)).toBe("unchanged");
    expect(classifyWalletChange(A, "")).toBe("disconnected");
    expect(classifyWalletChange("", "")).toBe("unchanged");
  });

  it("treats surrounding whitespace as the same account", () => {
    expect(classifyWalletChange(` ${A} `, A)).toBe("unchanged");
  });

  it("requires confirmation only for a different non-empty account", () => {
    expect(requiresAccountConfirmation("account-changed")).toBe(true);
    for (const change of ["connected", "disconnected", "unchanged"] as const) {
      expect(requiresAccountConfirmation(change)).toBe(false);
    }
  });

  it("names both accounts in the confirmation prompt", () => {
    const prompt = accountSwitchPrompt(A, B);
    expect(prompt).toContain(A.slice(0, 6));
    expect(prompt).toContain(B.slice(-4));
    expect(prompt).toContain("Confirm");
  });
});
