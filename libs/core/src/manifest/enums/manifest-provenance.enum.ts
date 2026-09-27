export enum ManifestProvenance {
  /** Written by a person. */
  Declared = 'declared',
  /** Drafted from telemetry (e.g. Tempo's service graph) for a person to confirm. */
  Discovered = 'discovered',
}
