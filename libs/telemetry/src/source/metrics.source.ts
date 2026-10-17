import { Injectable } from '@nestjs/common';
import { SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { TelemetryBackend } from '@heimdall/config';
import type { IConnectorSource } from '../connectors/connector-source.type';
import { PrometheusResultType } from '../connectors/prometheus/prometheus.enums';
import { TelemetryConnectorFactory } from '../connectors/telemetry-connector.factory';
import { TelemetryError } from '../errors';
import type { IMetricSeriesData, IMetricsRangeQuery } from './metrics-source.interface';
import { TelemetrySignal, TelemetrySpanAttribute } from './telemetry-source.enums';

const tracer = trace.getTracer('@heimdall/telemetry');

/**
 * Metric series for the engine: typed points and allowlisted labels, never the connector's raw
 * response (ADR 0008). Each query is a `telemetry.query` span with counts, never values.
 */
@Injectable()
export class MetricsSource {
  constructor(private readonly connectors: TelemetryConnectorFactory) {}

  async queryRange(
    source: IConnectorSource,
    request: IMetricsRangeQuery,
  ): Promise<IMetricSeriesData[]> {
    const span = tracer.startSpan(`telemetry.query ${TelemetryBackend.Prometheus}`, {
      kind: SpanKind.CLIENT,
      attributes: {
        [TelemetrySpanAttribute.Backend]: TelemetryBackend.Prometheus,
        [TelemetrySpanAttribute.Signal]: TelemetrySignal.Metrics,
        [TelemetrySpanAttribute.QueryText]: request.query,
      },
    });

    try {
      const result = await this.connectors.prometheus(source).queryRange({
        query: request.query,
        start: request.start,
        end: request.end,
        stepSeconds: request.stepSeconds,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      });
      const allowed = new Set(request.labels);
      const series =
        result.data.resultType === PrometheusResultType.Matrix
          ? result.data.series.map(({ labels, samples }) => ({
              labels: Object.fromEntries(
                Object.entries(labels).filter(([name]) => allowed.has(name)),
              ),
              points: samples.map(({ timestampMs, value }) => ({ timestampMs, value })),
            }))
          : [];

      span.setAttributes({
        [TelemetrySpanAttribute.Series]: series.length,
        [TelemetrySpanAttribute.Points]: series.reduce(
          (total, entry) => total + entry.points.length,
          0,
        ),
      });
      return series;
    } catch (error) {
      const type = error instanceof TelemetryError ? error.errorCode : 'unknown';

      span.setAttribute(TelemetrySpanAttribute.ErrorType, type);
      span.setStatus({ code: SpanStatusCode.ERROR, message: type });
      throw error;
    } finally {
      span.end();
    }
  }
}
