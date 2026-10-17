import type { LogLineFormat } from '../redaction/log-line.parser';
import type { RedactedText } from '../redaction/redacted-text';
import type { IRedactionSummary } from '../redaction/redaction-tally';

export interface ILogsRangeQuery {
  /** LogQL: a stream selector and line filters, built by the caller from the manifest. */
  readonly query: string;
  readonly start: Date;
  readonly end: Date;
  /** Lines read, newest first. */
  readonly limit: number;
  /**
   * Raw field key → meaning: the component's `telemetry.logs.fields`. Every other field is dropped
   * before anything else sees it (ADR 0008).
   */
  readonly fields: Readonly<Record<string, string>>;
  /** The component read; an attribute of the redaction counters. */
  readonly component: string;
  readonly signal?: AbortSignal;
}

export interface ILogRecord {
  readonly timestampMs: number;
  readonly format: LogLineFormat;
  /** Keyed by meaning (`message`, `severity`, …). An unstructured line is its `message`. */
  readonly fields: Readonly<Record<string, RedactedText>>;
}

export interface ILogBatch {
  /** Oldest first. */
  readonly records: readonly ILogRecord[];
  readonly redaction: IRedactionSummary;
}
