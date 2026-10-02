export enum BlindSpotReason {
  /** Emits nothing Heimdall can query. */
  NoTelemetry = 'no-telemetry',
  /** Has telemetry, but no indicator says what healthy means for it. */
  NoIndicators = 'no-indicators',
}
