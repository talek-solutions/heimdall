import { Inject, Injectable } from '@nestjs/common';
import { AuthScheme, TelemetryBackend } from '@heimdall/config';
import type { IConnectorSource } from '../connectors/connector-source.type';
import { TelemetryHttpClient } from '../connectors/http/telemetry-http.client';
import type {
  DirectTelemetryBackend,
  ITelemetryDatasourceConfig,
} from '../datasource/telemetry-datasource-config.model';
import { TELEMETRY_DATASOURCE_CONFIG } from '../datasource/telemetry-datasource.tokens';
import { TelemetryError, TelemetryErrorCode } from '../errors';
import { Timeline } from './engine/timeline';
import type { IFixtureBackend } from './fixture-backend';
import { fixtureBaseUrl } from './fixture-backend.constants';
import { createFixtureFetch } from './fixture-fetch';
import { FIXTURE_SCENARIO } from './fixture.tokens';
import { LokiFixtureBackend } from './loki/loki-fixture.backend';
import { PrometheusFixtureBackend } from './prometheus/prometheus-fixture.backend';
import type { IScenario } from './scenario/scenario.model';
import { TempoFixtureBackend } from './tempo/tempo-fixture.backend';
import { TraceGenerator } from './tempo/trace.generator';
import { TraceIdCodec } from './tempo/trace-id.codec';

interface IFixtureEnvironment {
  readonly scenario: IScenario;
  readonly timeline: Timeline;
  readonly traces: TraceGenerator;
}

/**
 * Builds real `TelemetryHttpClient`s whose `fetch` is a fixture backend. The
 * source's URL and auth are replaced: a fixture needs no credentials and must
 * not be able to reach a network.
 */
@Injectable()
export class FixtureBackendRegistry {
  private readonly fetchers = new Map<DirectTelemetryBackend, typeof fetch>();
  private shared: IFixtureEnvironment | undefined;

  constructor(
    @Inject(FIXTURE_SCENARIO) private readonly scenario: IScenario | undefined,
    @Inject(TELEMETRY_DATASOURCE_CONFIG) private readonly config: ITelemetryDatasourceConfig,
  ) {}

  public client(backend: DirectTelemetryBackend, source: IConnectorSource): TelemetryHttpClient {
    return new TelemetryHttpClient({
      source: {
        url: fixtureBaseUrl(backend),
        timeoutMs: source.timeoutMs,
        auth: { scheme: AuthScheme.None },
      },
      lookupEnv: () => undefined,
      fetchFn: this.fetchFor(backend),
    });
  }

  private fetchFor(backend: DirectTelemetryBackend): typeof fetch {
    const cached = this.fetchers.get(backend);

    if (cached !== undefined) {
      return cached;
    }
    const fetchFn = createFixtureFetch(this.createBackend(backend, this.environment(backend)));
    this.fetchers.set(backend, fetchFn);
    return fetchFn;
  }

  private createBackend(backend: DirectTelemetryBackend, environment: IFixtureEnvironment): IFixtureBackend {
    const { scenario, timeline, traces } = environment;

    switch (backend) {
      case TelemetryBackend.Prometheus:
        return new PrometheusFixtureBackend(scenario.metrics, timeline);
      case TelemetryBackend.Loki:
        return new LokiFixtureBackend(scenario.logs, timeline, scenario.seed, traces);
      case TelemetryBackend.Tempo:
        return new TempoFixtureBackend(scenario.traces, traces, timeline);
      default: {
        const unhandled: never = backend;
        throw new TelemetryError(
          TelemetryErrorCode.InvalidDatasourceConfig,
          `no fixture backend for '${String(unhandled)}'`,
        );
      }
    }
  }

  /** Built once and shared, so a trace ID in a Loki line is one the Tempo fixture can serve. */
  private environment(backend: DirectTelemetryBackend): IFixtureEnvironment {
    if (this.shared !== undefined) {
      return this.shared;
    }
    const scenario = this.scenario;
    const anchor = this.config.fixture?.anchor;

    if (scenario === undefined || anchor === undefined) {
      throw new TelemetryError(
        TelemetryErrorCode.InvalidDatasourceConfig,
        `${backend} is not configured as a fixture datasource`,
      );
    }
    const timeline = new Timeline(anchor, scenario.durationMs);
    const codec = new TraceIdCodec(scenario.seed, scenario.contentHash);
    this.shared = {
      scenario,
      timeline,
      traces: new TraceGenerator(scenario.traces, scenario.seed, timeline, codec),
    };
    return this.shared;
  }
}
