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

/** How an excursion rose, read from the profile of the window. */
export enum ProfileShape {
  /** Nothing in the window deviates from the baseline. */
  Flat = 'flat',
  /** Got near its peak within one bucket of starting. */
  Step = 'step',
  /** Took several buckets to get near its peak. */
  Ramp = 'ramp',
  /** Short, and already falling back. */
  Spike = 'spike',
}

/** Where an excursion stands at the end of the window. */
export enum ProfileState {
  Ongoing = 'ongoing',
  Recovering = 'recovering',
  Recovered = 'recovered',
}
