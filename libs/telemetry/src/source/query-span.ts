import { SpanKind, SpanStatusCode, trace, type Span } from '@opentelemetry/api';
import type { TelemetryBackend } from '@heimdall/config';
import { TelemetryError } from '../errors';
import {
  TelemetrySpanAttribute,
  TelemetrySpanName,
  type TelemetrySignal,
} from './telemetry-source.enums';

const tracer = trace.getTracer('@heimdall/telemetry');
const UNKNOWN_ERROR = 'unknown';

/** One `telemetry.query` span around a backend call: the query text and counts, never results. */
export async function withQuerySpan<T>(
  backend: TelemetryBackend,
  signal: TelemetrySignal,
  queryText: string | undefined,
  run: (span: Span) => Promise<T>,
): Promise<T> {
  const span = tracer.startSpan(`${TelemetrySpanName.Query} ${backend}`, {
    kind: SpanKind.CLIENT,
    attributes: {
      [TelemetrySpanAttribute.Backend]: backend,
      [TelemetrySpanAttribute.Signal]: signal,
      ...(queryText === undefined ? {} : { [TelemetrySpanAttribute.QueryText]: queryText }),
    },
  });

  try {
    return await run(span);
  } catch (error) {
    const type = error instanceof TelemetryError ? error.errorCode : UNKNOWN_ERROR;

    span.setAttribute(TelemetrySpanAttribute.ErrorType, type);
    span.setStatus({ code: SpanStatusCode.ERROR, message: type });
    throw error;
  } finally {
    span.end();
  }
}

const SELECTOR_END = /^\{(?:[^}"`]|"(?:[^"\\]|\\.)*"|`[^`]*`)*\}/;
const LINE_FILTER = /(\|=|!=|\|~|!~)\s*("(?:[^"\\]|\\.)*"|`[^`]*`)/g;
export const MASKED_FILTER = '"<filter>"';

/**
 * A LogQL query for a span: line-filter literals can come from log content or a model's tool call,
 * so they are masked; the stream selector, which the manifest wrote, is kept.
 */
export function maskLineFilters(query: string): string {
  const selector = SELECTOR_END.exec(query)?.[0] ?? '';

  return `${selector}${query.slice(selector.length).replace(LINE_FILTER, `$1 ${MASKED_FILTER}`)}`;
}
