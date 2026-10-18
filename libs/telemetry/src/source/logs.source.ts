import { Inject, Injectable, Optional } from '@nestjs/common';
import { FieldSemantic, TelemetryBackend } from '@heimdall/config';
import type { IConnectorSource } from '../connectors/connector-source.type';
import type { LokiStream } from '../connectors/loki/api/loki.response';
import { LokiDirection, LokiResultType } from '../connectors/loki/loki.enums';
import { TelemetryConnectorFactory } from '../connectors/telemetry-connector.factory';
import { LogLineFormat, parseLogLine } from '../redaction/log-line.parser';
import type { RedactedText } from '../redaction/redacted-text';
import { RedactionTally } from '../redaction/redaction-tally';
import { recordRedaction } from '../redaction/redaction.telemetry';
import type { Redactor } from '../redaction/redactor';
import type { ILogBatch, ILogRecord, ILogsRangeQuery } from './logs-source.interface';
import { maskLineFilters, withQuerySpan } from './query-span';
import { TelemetrySignal, TelemetrySpanAttribute } from './telemetry-source.enums';
import {
  intercept,
  TelemetryOperation,
  type ITelemetrySourceInterceptor,
} from './telemetry-source.interceptor';
import { REDACTOR, TELEMETRY_SOURCE_INTERCEPTOR } from './telemetry-source.tokens';

const NANOS_PER_MILLI = 1_000_000n;

/**
 * Log lines for the engine, redacted (ADR 0008): each line is parsed, every field the manifest does
 * not map is dropped, and what is left is scrubbed. An unstructured line is its message. Stream
 * labels never leave; the component already names the stream.
 */
@Injectable()
export class LogsSource {
  constructor(
    private readonly connectors: TelemetryConnectorFactory,
    @Inject(REDACTOR) private readonly redactor: Redactor,
    @Optional()
    @Inject(TELEMETRY_SOURCE_INTERCEPTOR)
    private readonly interceptor?: ITelemetrySourceInterceptor,
  ) {}

  async queryRange(source: IConnectorSource, request: ILogsRangeQuery): Promise<ILogBatch> {
    const call = {
      operation: TelemetryOperation.LogsQueryRange,
      source: source.url,
      request: {
        query: request.query,
        start: request.start.toISOString(),
        end: request.end.toISOString(),
        limit: request.limit,
        fields: request.fields,
        component: request.component,
      },
    };

    return intercept(this.interceptor, call, () => this.read(source, request));
  }

  private async read(source: IConnectorSource, request: ILogsRangeQuery): Promise<ILogBatch> {
    const streams = await withQuerySpan(
      TelemetryBackend.Loki,
      TelemetrySignal.Logs,
      maskLineFilters(request.query),
      async (span) => {
        const result = await this.connectors.loki(source).queryRange({
          query: request.query,
          start: request.start,
          end: request.end,
          limit: request.limit,
          direction: LokiDirection.Backward,
          ...(request.signal === undefined ? {} : { signal: request.signal }),
        });
        const found = result.resultType === LokiResultType.Streams ? result.streams : [];

        span.setAttribute(
          TelemetrySpanAttribute.Records,
          found.reduce((total, stream) => total + stream.entries.length, 0),
        );
        return found;
      },
    );
    const tally = new RedactionTally();
    const records = this.redact(streams, request.fields, tally);
    const redaction = tally.summary();

    recordRedaction(TelemetrySignal.Logs, request.component, redaction);
    return { records, redaction };
  }

  private redact(
    streams: readonly LokiStream[],
    mapping: Readonly<Record<string, string>>,
    tally: RedactionTally,
  ): ILogRecord[] {
    return streams
      .flatMap((stream) => stream.entries)
      .map((entry) => {
        tally.records += 1;
        const parsed = parseLogLine(entry.line);
        const fields: Record<string, RedactedText> = {};

        if (parsed.format === LogLineFormat.Unstructured) {
          fields[FieldSemantic.Message] = this.redactor.redact(entry.line, tally);
        }
        for (const [key, value] of parsed.fields) {
          // Own keys only: a line's `constructor=` must not find Object.prototype's.
          const meaning = Object.hasOwn(mapping, key) ? mapping[key] : undefined;

          if (meaning === undefined) {
            tally.drop(key);
          } else {
            fields[meaning] = this.redactor.redact(value, tally);
          }
        }
        return {
          timestampMs: Number(BigInt(entry.timestampNs) / NANOS_PER_MILLI),
          format: parsed.format,
          fields,
        };
      })
      .sort((a, b) => a.timestampMs - b.timestampMs);
  }
}
