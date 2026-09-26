import type { MetricSeries, MetricVectorSample } from '../../shared/metrics.response';
import type { LokiResultType } from '../loki.enums';

export interface LokiLogEntry {
  /** Unix epoch nanoseconds, kept as a string so no precision is lost. */
  readonly timestampNs: string;
  readonly line: string;
}

export interface LokiStream {
  readonly labels: Readonly<Record<string, string>>;
  readonly entries: readonly LokiLogEntry[];
}

export type LokiQueryResult =
  | { readonly resultType: LokiResultType.Streams; readonly streams: readonly LokiStream[] }
  | { readonly resultType: LokiResultType.Matrix; readonly series: readonly MetricSeries[] }
  | { readonly resultType: LokiResultType.Vector; readonly samples: readonly MetricVectorSample[] };
