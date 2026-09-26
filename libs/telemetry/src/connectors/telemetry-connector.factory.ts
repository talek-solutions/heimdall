import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { IConnectorSource } from './connector-source.type';
import { TelemetryHttpClient } from './http/telemetry-http.client';
import { LokiConnector } from './loki/loki.connector';
import { PrometheusConnector } from './prometheus/prometheus.connector';
import { TempoConnector } from './tempo/tempo.connector';

/**
 * Builds a connector per source: a context can hold several sources of the same
 * backend, so connectors are not singletons. Credentials are read through
 * `ConfigService` on each request, so `.env` values count and a missing one only
 * fails the command that queries.
 */
@Injectable()
export class TelemetryConnectorFactory {
  constructor(private readonly config: ConfigService) {}

  public loki(source: IConnectorSource): LokiConnector {
    return new LokiConnector(this.client(source));
  }

  public prometheus(source: IConnectorSource): PrometheusConnector {
    return new PrometheusConnector(this.client(source));
  }

  public tempo(source: IConnectorSource): TempoConnector {
    return new TempoConnector(this.client(source));
  }

  private client(source: IConnectorSource): TelemetryHttpClient {
    return new TelemetryHttpClient({
      source,
      lookupEnv: (name) => this.config.get<string>(name),
    });
  }
}
