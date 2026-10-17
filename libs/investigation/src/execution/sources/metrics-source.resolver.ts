import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  AuthScheme,
  HEIMDALL_CONFIG,
  SignalType,
  TelemetryBackend,
  type IHeimdallConfig,
} from '@heimdall/config';
import {
  DatasourceType,
  TELEMETRY_DATASOURCE_CONFIG,
  type IConnectorSource,
  type ITelemetryDatasourceConfig,
} from '@heimdall/telemetry';
import { InvestigationError, InvestigationErrorCode } from '../../errors';
import type { IPlanEnvironment } from '../../interfaces';

const FIXTURE_TIMEOUT_MS = 30_000;

/**
 * The Prometheus source a run queries: the environment's context in `~/.heimdall/config.yaml`,
 * or a placeholder in fixture mode, where the fixture answers whatever the source says (ADR 0014).
 */
@Injectable()
export class MetricsSourceResolver {
  constructor(
    @Inject(TELEMETRY_DATASOURCE_CONFIG) private readonly datasources: ITelemetryDatasourceConfig,
    // Global and loaded by the application; absent in specs and fixture-only runs.
    @Optional() @Inject(HEIMDALL_CONFIG) private readonly config?: IHeimdallConfig,
  ) {}

  resolve(environment: IPlanEnvironment | undefined): IConnectorSource {
    if (this.datasources.datasources[TelemetryBackend.Prometheus] === DatasourceType.Fixture) {
      return {
        url: 'http://prometheus.fixture.invalid',
        timeoutMs: FIXTURE_TIMEOUT_MS,
        auth: { scheme: AuthScheme.None },
      };
    }
    const { config } = this;

    if (config === undefined) {
      throw new InvestigationError(
        InvestigationErrorCode.SourceMissing,
        'no ~/.heimdall/config.yaml is loaded, so no live source can be found',
      );
    }
    const name = environment?.context ?? config.currentContext;

    if (name === null) {
      throw new InvestigationError(
        InvestigationErrorCode.SourceMissing,
        'the System declares no environment and no context is selected; set currentContext in ~/.heimdall/config.yaml',
      );
    }
    const context = config.contexts.find((candidate) => candidate.name === name);

    if (context === undefined) {
      throw new InvestigationError(
        InvestigationErrorCode.SourceMissing,
        `context '${name}' is not in ~/.heimdall/config.yaml; declared contexts are ${config.contexts.map((entry) => entry.name).join(', ') || '(none)'}`,
      );
    }
    const sources = context.sources.flatMap((alias) =>
      config.sources.filter((source) => source.alias === alias),
    );
    const prometheus = sources.find((source) => source.type === TelemetryBackend.Prometheus);

    if (prometheus !== undefined) {
      return prometheus;
    }
    if (
      sources.some(
        (source) =>
          source.type === TelemetryBackend.Grafana && source.signal === SignalType.Metrics,
      )
    ) {
      throw new InvestigationError(
        InvestigationErrorCode.SourceUnsupported,
        `context '${name}' reaches metrics through Grafana, which execution cannot query yet; add a direct prometheus source`,
      );
    }
    throw new InvestigationError(
      InvestigationErrorCode.SourceMissing,
      `context '${name}' has no prometheus source; add one to ~/.heimdall/config.yaml`,
    );
  }
}
