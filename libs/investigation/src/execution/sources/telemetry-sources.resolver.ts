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
  type DirectTelemetryBackend,
  type IConnectorSource,
  type ITelemetryDatasourceConfig,
} from '@heimdall/telemetry';
import { TranscriptPin, TranscriptSession } from '@heimdall/transcript';
import { InvestigationError, InvestigationErrorCode } from '../../errors';
import type { IPlanEnvironment } from '../../interfaces';
import type { ICheckProblem } from '../checks/check-result.interface';

const FIXTURE_TIMEOUT_MS = 30_000;

/** A logs or traces source, or why there is none: that fails its checks, not the run. */
export type IOptionalSource =
  | { readonly ok: true; readonly source: IConnectorSource }
  | { readonly ok: false; readonly problem: ICheckProblem };

export interface IExecutionSources {
  readonly metrics: IConnectorSource;
  readonly logs: IOptionalSource;
  readonly traces: IOptionalSource;
}

const SIGNALS: Readonly<Record<DirectTelemetryBackend, SignalType>> = {
  [TelemetryBackend.Prometheus]: SignalType.Metrics,
  [TelemetryBackend.Loki]: SignalType.Logs,
  [TelemetryBackend.Tempo]: SignalType.Traces,
};

/**
 * The sources a run queries: the environment's context in `~/.heimdall/config.yaml`, or a
 * placeholder per fixture backend, where the fixture answers whatever the source says (ADR 0014).
 * Metrics are required; logs and traces only fail the checks that need them.
 */
@Injectable()
export class TelemetrySourcesResolver {
  constructor(
    @Inject(TELEMETRY_DATASOURCE_CONFIG) private readonly datasources: ITelemetryDatasourceConfig,
    // Global and loaded by the application; absent in specs and fixture-only runs.
    @Optional() @Inject(HEIMDALL_CONFIG) private readonly config?: IHeimdallConfig,
    @Optional() private readonly session?: TranscriptSession,
  ) {}

  /** A replay gets the sources the recorded run resolved (ADR 0007): no config file is read. */
  resolve(environment: IPlanEnvironment | undefined): IExecutionSources {
    const resolve = (): IExecutionSources => ({
      metrics: this.source(environment, TelemetryBackend.Prometheus),
      logs: this.optional(environment, TelemetryBackend.Loki),
      traces: this.optional(environment, TelemetryBackend.Tempo),
    });

    return this.session === undefined
      ? resolve()
      : this.session.pin(TranscriptPin.Sources, resolve);
  }

  private optional(
    environment: IPlanEnvironment | undefined,
    backend: DirectTelemetryBackend,
  ): IOptionalSource {
    try {
      return { ok: true, source: this.source(environment, backend) };
    } catch (error) {
      if (!(error instanceof InvestigationError)) {
        throw error;
      }
      return { ok: false, problem: { errorCode: error.errorCode, message: error.message } };
    }
  }

  private source(
    environment: IPlanEnvironment | undefined,
    backend: DirectTelemetryBackend,
  ): IConnectorSource {
    if (this.datasources.datasources[backend] === DatasourceType.Fixture) {
      return {
        url: `http://${backend}.fixture.invalid`,
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
    const direct = sources.find((source) => source.type === backend);

    if (direct !== undefined) {
      // What a connector reads, and nothing else: a transcript pins this (ADR 0007).
      return { url: direct.url, timeoutMs: direct.timeoutMs, auth: direct.auth };
    }
    if (
      sources.some(
        (source) => source.type === TelemetryBackend.Grafana && source.signal === SIGNALS[backend],
      )
    ) {
      throw new InvestigationError(
        InvestigationErrorCode.SourceUnsupported,
        `context '${name}' reaches ${SIGNALS[backend]} through Grafana, which execution cannot query yet; add a direct ${backend} source`,
      );
    }
    throw new InvestigationError(
      InvestigationErrorCode.SourceMissing,
      `context '${name}' has no ${backend} source; add one to ~/.heimdall/config.yaml`,
    );
  }
}
