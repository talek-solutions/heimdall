export enum ExpectationKind {
  /** Healthy means "close to its recent history". */
  Baseline = 'baseline',
  Slo = 'slo',
  Threshold = 'threshold',
  NonZero = 'nonZero',
}
