/** Whether the caller waits for the callee; used by dependencies and flows alike. */
export enum InteractionMode {
  Sync = 'sync',
  Async = 'async',
}
