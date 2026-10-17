import { Injectable } from '@nestjs/common';
import { TelemetryBackend } from '@heimdall/config';
import type { IConnectorSource } from '../connectors/connector-source.type';
import { PrometheusResultType } from '../connectors/prometheus/prometheus.enums';
import { TelemetryConnectorFactory } from '../connectors/telemetry-connector.factory';
import type { IMetricSeriesData, IMetricsRangeQuery } from './metrics-source.interface';
import { withQuerySpan } from './query-span';
import { TelemetrySignal, TelemetrySpanAttribute } from './telemetry-source.enums';

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
    return withQuerySpan(
      TelemetryBackend.Prometheus,
      TelemetrySignal.Metrics,
      request.query,
      async (span) => {
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
      },
    );
  }
}
