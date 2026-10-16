export enum ToolResultStatus {
  Ok = 'ok',
  /** Sent back to the model, which may correct itself; never thrown. */
  Error = 'error',
}
