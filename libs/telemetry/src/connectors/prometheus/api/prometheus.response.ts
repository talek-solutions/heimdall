import type { MetricSample, MetricSeries, MetricVectorSample } from '../../shared/metrics.response';
import type { PrometheusResultType } from '../prometheus.enums';

export type PrometheusQueryData =
  | {
      readonly resultType: PrometheusResultType.Vector;
      readonly samples: readonly MetricVectorSample[];
    }
  | { readonly resultType: PrometheusResultType.Matrix; readonly series: readonly MetricSeries[] }
  | { readonly resultType: PrometheusResultType.Scalar; readonly sample: MetricSample }
  | {
      readonly resultType: PrometheusResultType.String;
      readonly timestampMs: number;
      readonly value: string;
    };

export interface PrometheusQueryResult {
  readonly data: PrometheusQueryData;
  /** Non-fatal backend warnings, e.g. partial results. */
  readonly warnings: readonly string[];
}
