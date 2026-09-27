import type { TempoSpanKind } from '../../connectors/tempo/tempo.enums';
import type { ICurve } from '../engine/curve';
import type { IMatchable } from '../engine/query-matcher';
import type { TemplateSegment } from '../loki/log-template';

export interface IMetricSeries extends IMatchable {
  readonly id: string;
  readonly curve: ICurve;
}

export interface ILogTemplate {
  readonly weight: ICurve;
  readonly segments: readonly TemplateSegment[];
}

export interface ILogStream extends IMatchable {
  readonly id: string;
  /** Seeds the stream's generation; also orders simultaneous lines deterministically. */
  readonly key: number;
  /** Lines per second. */
  readonly rate: ICurve;
  readonly templates: readonly ILogTemplate[];
}

export interface ILokiSeries extends IMetricSeries {
  readonly scaleByRange: boolean;
}

export interface ILogs {
  readonly streams: readonly ILogStream[];
  /** Metric LogQL results. */
  readonly series: readonly ILokiSeries[];
}

export type SpanAttributeValue = string | number | boolean;

export interface ISpanTemplate {
  readonly service: string;
  readonly name: string;
  readonly kind: TempoSpanKind;
  readonly attributes: Readonly<Record<string, SpanAttributeValue>>;
  readonly errorAttributes: Readonly<Record<string, SpanAttributeValue>>;
  /** Fraction of the parent's duration. */
  readonly share: ICurve;
  readonly errorSource: boolean;
  readonly errorMessage: string | undefined;
  readonly children: readonly ISpanTemplate[];
}

export interface ITraceTemplate extends IMatchable {
  readonly id: string;
  /** Position in `traces.yaml`; part of every trace ID. */
  readonly index: number;
  readonly key: number;
  /** Traces per second. */
  readonly rate: ICurve;
  /** Median root duration, milliseconds. */
  readonly duration: ICurve;
  readonly errorDuration: ICurve | undefined;
  readonly jitter: number;
  /** Probability that a trace is an error. */
  readonly error: ICurve;
  readonly root: ISpanTemplate;
  /** Every span that may fail, in depth-first order; the root when none is marked. */
  readonly errorSources: readonly ISpanTemplate[];
}

/** A validated, compiled scenario: every regex compiled, every `ref` resolved. */
export interface IScenario {
  readonly name: string;
  readonly seed: number;
  readonly durationMs: number;
  readonly resolutionMs: number;
  /** sha-256 over every scenario file: changes whenever the scenario does. */
  readonly contentHash: string;
  readonly metrics: readonly IMetricSeries[];
  readonly logs: ILogs;
  readonly traces: readonly ITraceTemplate[];
}
