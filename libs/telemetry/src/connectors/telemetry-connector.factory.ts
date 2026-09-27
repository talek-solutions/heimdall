import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TelemetryBackend } from '@heimdall/config';
import { DatasourceType } from '../datasource/datasource-type.enum';
import type {
  DirectTelemetryBackend,
  ITelemetryDatasourceConfig,
} from '../datasource/telemetry-datasource-config.model';
import { TELEMETRY_DATASOURCE_CONFIG } from '../datasource/telemetry-datasource.tokens';
import { TelemetryError, TelemetryErrorCode } from '../errors';
import { FixtureBackendRegistry } from '../fixture/fixture-backend.registry';
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
 *
 * Whether a backend is answered over HTTP or by a fixture is decided here, from
 * `*_DATASOURCE_TYPE`; the connectors themselves cannot tell the difference.
 */
@Injectable()
export class TelemetryConnectorFactory {
  constructor(
    private readonly config: ConfigService,
    @Inject(TELEMETRY_DATASOURCE_CONFIG) private readonly datasources: ITelemetryDatasourceConfig,
    private readonly fixtures: FixtureBackendRegistry,
  ) {}

  public loki(source: IConnectorSource): LokiConnector {
    return new LokiConnector(this.client(TelemetryBackend.Loki, source));
  }

  public prometheus(source: IConnectorSource): PrometheusConnector {
    return new PrometheusConnector(this.client(TelemetryBackend.Prometheus, source));
  }

  public tempo(source: IConnectorSource): TempoConnector {
    return new TempoConnector(this.client(TelemetryBackend.Tempo, source));
  }

  private client(backend: DirectTelemetryBackend, source: IConnectorSource): TelemetryHttpClient {
    const type = this.datasources.datasources[backend];

    switch (type) {
      case DatasourceType.Http:
        return new TelemetryHttpClient({
          source,
          lookupEnv: (name) => this.config.get<string>(name),
        });
      case DatasourceType.Fixture:
        return this.fixtures.client(backend, source);
      default: {
        const unhandled: never = type;
        throw new TelemetryError(
          TelemetryErrorCode.InvalidDatasourceConfig,
          `no datasource for type '${String(unhandled)}'`,
        );
      }
    }
  }
}
