// What staff see before suspending a team (approvals queue and Drill teams).
// One place, so both pages say the same thing and the unit test can read it.
// Suspending stops the team's alerts at once, so it takes a second, deliberate
// click: on 2026-11-11 a drill team was suspended by a stray click on the
// Suspend button that replaced Activate in the same spot.

export const SUSPEND_COPY = {
  /** Opens the confirm; never submits. */
  trigger: "Suspend…",
  heading: (orgName: string) => `Suspend ${orgName}?`,
  effect:
    "AvAI stops offering this team and stops sending it alerts at once, including for check-outs that already named it.",
  undo: {
    real: "To bring it back you move it back to review, and it needs a new approval.",
    drill: "To bring it back you move it back to pending, then activate it again.",
  },
  notePlaceholder: "Reason for suspending (optional, recorded in the audit log)",
  confirm: "Suspend team",
  cancel: "Cancel",
} as const;
