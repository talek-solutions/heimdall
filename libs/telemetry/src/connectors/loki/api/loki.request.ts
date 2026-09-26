import type { LokiDirection } from '../loki.enums';

interface LokiRequestBase {
  /** LogQL, passed through untouched (ADR 0005). */
  readonly query: string;
  /** Max log lines; Loki's own default applies when omitted. */
  readonly limit?: number;
  readonly direction?: LokiDirection;
  readonly signal?: AbortSignal;
}

export interface LokiInstantQueryRequest extends LokiRequestBase {
  /** Evaluation time; defaults to now on the server. */
  readonly time?: Date;
}

export interface LokiRangeQueryRequest extends LokiRequestBase {
  readonly start: Date;
  readonly end: Date;
  /** Metric query resolution. */
  readonly stepSeconds?: number;
}
