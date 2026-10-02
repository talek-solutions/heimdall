/** In the order checks run; each tier depends on the one before (ADR 0016). */
export enum CheckTier {
  /** Is it broken, and since when? */
  Confirm = 'confirm',
  /** Which step does the fault surface at? */
  Localise = 'localise',
  /** Why that step? Runs only when the step fails. */
  Explain = 'explain',
  /** Logs and traces backing the explanation. Runs only when the step fails. */
  Corroborate = 'corroborate',
  /** What else is hurt; reported, never treated as a cause. */
  Impact = 'impact',
}
