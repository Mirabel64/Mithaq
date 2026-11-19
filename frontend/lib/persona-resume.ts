/**
 * lib/persona-resume.ts
 *
 * Turns a Persona inquiry status into a distinct holder-facing state (#75).
 *
 * A single "verification failed" message hides four very different situations:
 * an inquiry that is still running, one the provider approved, one the
 * provider denied, and one that expired or could not be reached. They need
 * different next actions — wait, continue, contact support, or start again —
 * so the verify flow maps the raw status through this module instead of
 * guessing in the UI.
 */

export type PersonaResumeState =
  "pending" | "approved" | "declined" | "expired" | "unavailable" | "unknown";

export interface PersonaResumeView {
  state: PersonaResumeState;
  /** Short label for the current state. */
  label: string;
  /** What the holder should do next, phrased as guidance, not an error code. */
  guidance: string;
  /** Safe next action; `none` means no user action is needed. */
  nextAction: "wait" | "continue" | "contact-support" | "restart" | "none";
}

const VIEWS: Record<PersonaResumeState, Omit<PersonaResumeView, "state">> = {
  pending: {
    label: "Verification in progress",
    guidance:
      "The identity provider is still working on your inquiry. You can keep this page open — it checks again automatically.",
    nextAction: "wait",
  },
  approved: {
    label: "Verification approved",
    guidance:
      "The provider approved your inquiry. Your credential can be issued now.",
    nextAction: "none",
  },
  declined: {
    label: "Verification not approved",
    guidance:
      "The identity provider did not approve this inquiry. Check the details you submitted before trying again; there is no need to switch issuers.",
    nextAction: "restart",
  },
  expired: {
    label: "Verification expired",
    guidance:
      "This inquiry expired or was closed before it finished. Start a new verification to continue — your wallet and claim choices are kept.",
    nextAction: "restart",
  },
  unavailable: {
    label: "Verification status unavailable",
    guidance:
      "The identity provider could not be reached to check this inquiry. Nothing was declined; retry in a moment or contact the issuer if it keeps happening.",
    nextAction: "contact-support",
  },
  unknown: {
    label: "Verification status unknown",
    guidance:
      "This inquiry's status could not be interpreted. Retry the check rather than assuming it passed or failed.",
    nextAction: "wait",
  },
};

const STATE_BY_STATUS: Record<string, PersonaResumeState> = {
  created: "pending",
  pending: "pending",
  initiated: "pending",
  in_progress: "pending",
  needs_review: "pending",
  approved: "approved",
  completed: "approved",
  declined: "declined",
  failed: "declined",
  expired: "expired",
  killed: "expired",
  unavailable: "unavailable",
  unconfigured: "unavailable",
  not_configured: "unavailable",
};

/**
 * Describe a Persona inquiry status. Unknown values stay `unknown` — the
 * module never guesses that an unrecognised status was an approval.
 */
export function describePersonaResumeStatus(
  status: string | null | undefined,
): PersonaResumeView {
  const key = (status ?? "").trim().toLowerCase();
  const state = STATE_BY_STATUS[key] ?? "unknown";
  return { state, ...VIEWS[state] };
}

/** True when the holder must take an action for the flow to continue. */
export function resumeNeedsAction(view: PersonaResumeView): boolean {
  return view.nextAction === "restart" || view.nextAction === "contact-support";
}
