import { metrics, trace } from '@opentelemetry/api';
import { TelemetrySpanName, type TelemetrySignal } from '../source/telemetry-source.enums';
import { RedactionAttribute, RedactionMetric } from './redaction.enums';
import type { IRedactionSummary } from './redaction-tally';

const INSTRUMENTATION_SCOPE = '@heimdall/telemetry';

/**
 * One `telemetry.redact` span and the redaction counters per batch, so over-redaction shows
 * (ADR 0008, Hard). Field names, matched text and values never become attributes.
 */
export function recordRedaction(
  signal: TelemetrySignal,
  component: string,
  summary: IRedactionSummary,
): void {
  const matches = Object.values(summary.matches).reduce((total, count) => total + count, 0);

  trace
    .getTracer(INSTRUMENTATION_SCOPE)
    .startSpan(TelemetrySpanName.Redact, {
      attributes: {
        [RedactionAttribute.Signal]: signal,
        [RedactionAttribute.Component]: component,
        [RedactionAttribute.Records]: summary.records,
        [RedactionAttribute.FieldsDropped]: summary.fieldsDropped,
        [RedactionAttribute.Matches]: matches,
        [RedactionAttribute.Truncated]: summary.truncated,
        ...Object.fromEntries(
          Object.entries(summary.matches).map(([scrubber, count]) => [
            `${RedactionAttribute.Matches}.${scrubber}`,
            count,
          ]),
        ),
      },
    })
    .end();

  // Taken per batch: the metrics API has no proxy, so a provider registered later still counts.
  const meter = metrics.getMeter(INSTRUMENTATION_SCOPE);

  meter
    .createCounter(RedactionMetric.Records, { unit: '{record}' })
    .add(summary.records, { [RedactionAttribute.Signal]: signal });
  meter
    .createCounter(RedactionMetric.FieldsDropped, { unit: '{field}' })
    .add(summary.fieldsDropped, {
      [RedactionAttribute.Signal]: signal,
      [RedactionAttribute.Component]: component,
    });
  const matchCounter = meter.createCounter(RedactionMetric.Matches, { unit: '{match}' });

  for (const [scrubber, count] of Object.entries(summary.matches)) {
    matchCounter.add(count, {
      [RedactionAttribute.Signal]: signal,
      [RedactionAttribute.Scrubber]: scrubber,
    });
  }
}
