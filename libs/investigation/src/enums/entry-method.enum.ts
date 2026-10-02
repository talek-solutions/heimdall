/** How the entry vertex was chosen. */
export enum EntryMethod {
  Model = 'model',
  /** Named by the caller, e.g. `--entry`; no model call. */
  Flag = 'flag',
  /** Chosen by the engineer among ambiguous model candidates. */
  Prompt = 'prompt',
}
