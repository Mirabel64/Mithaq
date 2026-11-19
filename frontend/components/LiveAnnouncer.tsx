"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

type Politeness = "polite" | "assertive";

type AnnounceFn = (message: string, politeness?: Politeness) => void;

const LiveAnnouncerContext = createContext<AnnounceFn | null>(null);

const visuallyHidden: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
};

/**
 * Returns `announce(message, politeness?)`, which speaks a status update to
 * screen readers through a shared aria-live region. Defaults to "polite";
 * use "assertive" for failures. Repeating the same message back-to-back is a
 * no-op so unchanged progress is not re-announced.
 */
export function useAnnounce(): AnnounceFn {
  const ctx = useContext(LiveAnnouncerContext);
  if (!ctx) throw new Error("useAnnounce must be used within a LiveAnnouncerProvider");
  return ctx;
}

export function LiveAnnouncerProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = useState<Record<Politeness, string>>({ polite: "", assertive: "" });
  const last = useRef<Record<Politeness, string>>({ polite: "", assertive: "" });

  const announce = useCallback<AnnounceFn>((message, politeness = "polite") => {
    if (last.current[politeness] === message) return;
    last.current[politeness] = message;
    setMessages((prev) => ({ ...prev, [politeness]: message }));
  }, []);

  const value = useMemo(() => announce, [announce]);

  return (
    <LiveAnnouncerContext.Provider value={value}>
      {children}
      <div style={visuallyHidden}>
        <div role="status" aria-live="polite" aria-atomic="true">
          {messages.polite}
        </div>
        <div role="alert" aria-live="assertive" aria-atomic="true">
          {messages.assertive}
        </div>
      </div>
    </LiveAnnouncerContext.Provider>
  );
}
