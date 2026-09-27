import type { ExpectationKind } from '../../enums';

export interface IBaselineExpectationV1 {
  readonly kind: ExpectationKind.Baseline;
}

/** At least one bound is set. Percentile bounds are upper limits on that percentile. */
export interface ISloExpectationV1 {
  readonly kind: ExpectationKind.Slo;
  readonly min?: number | undefined;
  readonly max?: number | undefined;
  readonly p50?: number | undefined;
  readonly p90?: number | undefined;
  readonly p95?: number | undefined;
  readonly p99?: number | undefined;
}

/** At least one bound is set. */
export interface IThresholdExpectationV1 {
  readonly kind: ExpectationKind.Threshold;
  readonly min?: number | undefined;
  readonly max?: number | undefined;
}

export interface INonZeroExpectationV1 {
  readonly kind: ExpectationKind.NonZero;
}

export type IExpectationV1 =
  IBaselineExpectationV1 | ISloExpectationV1 | IThresholdExpectationV1 | INonZeroExpectationV1;
