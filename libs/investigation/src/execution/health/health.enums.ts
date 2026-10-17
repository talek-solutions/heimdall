/** `.docs/design/health-evaluation.md`, Preliminary signal; evaluated in this order. */
export enum PreliminarySignal {
  NoData = 'no-data',
  Anomalous = 'anomalous',
  Borderline = 'borderline',
  Normal = 'normal',
}

/** Code's verdict for `slo`, `threshold` and `nonZero` expectations; the agent cannot override it. */
export enum ObjectiveVerdict {
  Met = 'met',
  Breached = 'breached',
  NoData = 'no-data',
}

export enum DeviationDirection {
  Up = 'up',
  Down = 'down',
}
