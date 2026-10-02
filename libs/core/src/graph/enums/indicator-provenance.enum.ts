export enum IndicatorProvenance {
  /** Written in the manifest. */
  Declared = 'declared',
  /** Inferred from metric definitions whose labels cover the subject. */
  Derived = 'derived',
}
