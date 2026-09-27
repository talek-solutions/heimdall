import type { IndicatorRole } from '../../enums';
import type { IExpectationV1 } from './expectation.interface';

export interface IRatioV1 {
  readonly numerator: string;
  readonly denominator: string;
}

/**
 * A metric plus the meaning of "healthy" for it. Exactly one of `metric` or `ratio`
 * is set. Metric references are `metric` on the owning component, or
 * `component/metric`; indicators without an owning component must use the latter.
 */
export interface IIndicatorV1 {
  readonly metric?: string | undefined;
  readonly ratio?: IRatioV1 | undefined;
  readonly role: IndicatorRole;
  readonly expect: IExpectationV1;
  /** A native backend query replacing the generated one (ADR 0015). */
  readonly query?: string | undefined;
  readonly description?: string | undefined;
}
