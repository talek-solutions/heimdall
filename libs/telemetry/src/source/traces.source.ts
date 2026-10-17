import { Inject, Injectable } from '@nestjs/common';
import { TelemetryBackend } from '@heimdall/config';
import type { IConnectorSource } from '../connectors/connector-source.type';
import type {
  TempoAttributes,
  TempoAttributeValue,
  TempoSpan,
} from '../connectors/tempo/api/tempo.response';
import { TelemetryConnectorFactory } from '../connectors/telemetry-connector.factory';
import type { RedactedText } from '../redaction/redacted-text';
import { RedactionTally } from '../redaction/redaction-tally';
import { recordRedaction } from '../redaction/redaction.telemetry';
import type { Redactor } from '../redaction/redactor';
import {
  EXCEPTION_ATTRIBUTE_ALLOWLIST,
  EXCEPTION_EVENT,
  ExceptionAttribute,
  SPAN_ATTRIBUTE_ALLOWLIST,
} from '../redaction/span-allowlist';
import { withQuerySpan } from './query-span';
import { TelemetrySignal, TelemetrySpanAttribute } from './telemetry-source.enums';
import { REDACTOR } from './telemetry-source.tokens';
import type {
  IRedactedException,
  IRedactedSpan,
  ITraceBatch,
  ITraceLookup,
  ITraceMatch,
  ITraceSearchBatch,
  ITraceSearchQuery,
  RedactedAttributes,
  RedactedValue,
} from './traces-source.interface';

const NANOS_PER_MILLI = 1_000_000n;
const RESOURCE_PREFIX = 'resource.';
const EVENT_PREFIX = 'event.';

/**
 * Spans for the engine, redacted (ADR 0008): only the semantic-convention attributes of
 * `SPAN_ATTRIBUTE_ALLOWLIST` and an exception's type and message survive, and every string that
 * does (names, status messages, values) is scrubbed.
 */
@Injectable()
export class TracesSource {
  constructor(
    private readonly connectors: TelemetryConnectorFactory,
    @Inject(REDACTOR) private readonly redactor: Redactor,
  ) {}

  async search(source: IConnectorSource, request: ITraceSearchQuery): Promise<ITraceSearchBatch> {
    const result = await withQuerySpan(
      TelemetryBackend.Tempo,
      TelemetrySignal.Traces,
      request.query,
      async (span) => {
        const found = await this.connectors.tempo(source).search({
          query: request.query,
          start: request.start,
          end: request.end,
          limit: request.limit,
          spansPerSpanSet: request.spansPerSpanSet,
          ...(request.signal === undefined ? {} : { signal: request.signal }),
        });

        span.setAttribute(TelemetrySpanAttribute.Records, found.traces.length);
        return found;
      },
    );
    const tally = new RedactionTally();
    const traces: ITraceMatch[] = result.traces.map((summary) => {
      const spans = summary.spanSets.flatMap((set) => set.spans);

      return {
        traceId: summary.traceId,
        rootServiceName: this.optional(summary.rootServiceName, tally),
        rootName: this.optional(summary.rootTraceName, tally),
        startMs: millis(summary.startTimeUnixNano),
        durationMs: summary.durationMs,
        matched: summary.spanSets.reduce((total, set) => total + set.matched, 0),
        spans: spans.map((span) => {
          tally.records += 1;
          return {
            spanId: span.spanId,
            name: this.optional(span.name, tally),
            startMs: millis(span.startTimeUnixNano),
            durationMs:
              span.durationNs === undefined
                ? undefined
                : Number(BigInt(span.durationNs) / NANOS_PER_MILLI),
            attributes: this.attributes(span.attributes, tally),
          };
        }),
      };
    });
    const redaction = tally.summary();

    recordRedaction(TelemetrySignal.Traces, request.component, redaction);
    return { traces, redaction };
  }

  async trace(source: IConnectorSource, request: ITraceLookup): Promise<ITraceBatch> {
    const found = await withQuerySpan(
      TelemetryBackend.Tempo,
      TelemetrySignal.Traces,
      undefined,
      async (span) => {
        const trace = await this.connectors.tempo(source).getTrace({
          traceId: request.traceId,
          ...(request.signal === undefined ? {} : { signal: request.signal }),
        });

        span.setAttribute(TelemetrySpanAttribute.Records, trace?.spans.length ?? 0);
        return trace;
      },
    );
    const tally = new RedactionTally();
    const trace =
      found === undefined
        ? undefined
        : { traceId: found.traceId, spans: found.spans.map((span) => this.span(span, tally)) };
    const redaction = tally.summary();

    recordRedaction(TelemetrySignal.Traces, request.component, redaction);
    return { trace, redaction };
  }

  private span(span: TempoSpan, tally: RedactionTally): IRedactedSpan {
    tally.records += 1;
    const exceptions: IRedactedException[] = [];

    for (const event of span.events) {
      if (event.name !== EXCEPTION_EVENT) {
        tally.drop(`${EVENT_PREFIX}${event.name}`);
        continue;
      }
      const kept = this.attributes(event.attributes, tally, EXCEPTION_ATTRIBUTE_ALLOWLIST);
      exceptions.push({
        type: text(kept[ExceptionAttribute.Type]),
        message: text(kept[ExceptionAttribute.Message]),
      });
    }
    for (const name of Object.keys(span.resourceAttributes)) {
      if (!SPAN_ATTRIBUTE_ALLOWLIST.has(name)) {
        tally.drop(`${RESOURCE_PREFIX}${name}`);
      }
    }
    return {
      spanId: span.spanId,
      parentSpanId: span.parentSpanId,
      service: this.optional(span.serviceName, tally),
      name: this.redactor.redact(span.name, tally),
      kind: span.kind,
      startMs: millis(span.startTimeUnixNano),
      durationMs: span.durationMs,
      status: { code: span.status.code, message: this.optional(span.status.message, tally) },
      attributes: this.attributes(span.attributes, tally),
      exceptions,
    };
  }

  private attributes(
    attributes: TempoAttributes,
    tally: RedactionTally,
    allowlist: ReadonlySet<string> = SPAN_ATTRIBUTE_ALLOWLIST,
  ): RedactedAttributes {
    const kept: Record<string, RedactedValue> = {};

    for (const [name, value] of Object.entries(attributes)) {
      if (!allowlist.has(name)) {
        tally.drop(name);
        continue;
      }
      kept[name] = this.value(value, tally);
    }
    return kept;
  }

  private value(value: TempoAttributeValue, tally: RedactionTally): RedactedValue {
    if (typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }
    return this.redactor.redact(typeof value === 'string' ? value : JSON.stringify(value), tally);
  }

  private optional(value: string | undefined, tally: RedactionTally): RedactedText | undefined {
    return value === undefined ? undefined : this.redactor.redact(value, tally);
  }
}

function millis(nanos: string): number {
  return Number(BigInt(nanos) / NANOS_PER_MILLI);
}

function text(value: RedactedValue | undefined): RedactedText | undefined {
  return typeof value === 'string' ? value : undefined;
}
