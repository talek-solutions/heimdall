import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AuthScheme, SignalType, TelemetryBackend, type IHeimdallConfig } from '@heimdall/config';
import { DatasourceType, type ITelemetryDatasourceConfig } from '@heimdall/telemetry';
import { InvestigationError, InvestigationErrorCode } from '../../errors';
import { TelemetrySourcesResolver } from './telemetry-sources.resolver';

const PROMETHEUS = {
  alias: 'prod-prom',
  type: TelemetryBackend.Prometheus,
  url: 'https://prometheus.example',
  auth: { scheme: AuthScheme.None },
  timeoutMs: 10_000,
  metadata: { labels: {}, annotations: {} },
} as const;
const LOKI = {
  ...PROMETHEUS,
  alias: 'prod-loki',
  type: TelemetryBackend.Loki,
  url: 'https://loki.example',
} as const;
const GRAFANA = {
  ...PROMETHEUS,
  alias: 'prod-grafana',
  type: TelemetryBackend.Grafana,
  datasourceUid: 'abc',
  signal: SignalType.Metrics,
} as const;

function config(sources: readonly unknown[], contexts: Record<string, string[]>): IHeimdallConfig {
  return {
    currentContext: 'prod',
    sources,
    contexts: Object.entries(contexts).map(([name, aliases]) => ({
      name,
      sources: aliases,
      metadata: { labels: {}, annotations: {} },
    })),
  } as unknown as IHeimdallConfig;
}

function datasources(prometheus: DatasourceType): ITelemetryDatasourceConfig {
  return {
    datasources: {
      [TelemetryBackend.Prometheus]: prometheus,
      [TelemetryBackend.Loki]: DatasourceType.Http,
      [TelemetryBackend.Tempo]: DatasourceType.Http,
    },
    fixture: undefined,
  };
}

const prod = { name: 'prod', context: 'prod' };

function rejectsWith(code: InvestigationErrorCode, fn: () => unknown): void {
  assert.throws(
    fn,
    (error: unknown) => error instanceof InvestigationError && error.errorCode === code,
  );
}

describe('TelemetrySourcesResolver', () => {
  it("uses the environment's context's prometheus source", () => {
    const resolver = new TelemetrySourcesResolver(
      datasources(DatasourceType.Http),
      config([GRAFANA, PROMETHEUS], { prod: ['prod-grafana', 'prod-prom'] }),
    );

    assert.equal(resolver.resolve(prod).metrics.url, 'https://prometheus.example');
  });

  it('needs no config in fixture mode', () => {
    const resolver = new TelemetrySourcesResolver(datasources(DatasourceType.Fixture));

    assert.match(resolver.resolve(prod).metrics.url, /fixture\.invalid/);
  });

  it('says so when a live source is needed and no user config is loaded', () => {
    rejectsWith(InvestigationErrorCode.SourceMissing, () =>
      new TelemetrySourcesResolver(datasources(DatasourceType.Http)).resolve(prod),
    );
  });

  it('names a missing context, a missing source and a Grafana-only source', () => {
    rejectsWith(InvestigationErrorCode.SourceMissing, () =>
      new TelemetrySourcesResolver(datasources(DatasourceType.Http), config([], {})).resolve(prod),
    );
    rejectsWith(InvestigationErrorCode.SourceMissing, () =>
      new TelemetrySourcesResolver(
        datasources(DatasourceType.Http),
        config([], { prod: [] }),
      ).resolve(prod),
    );
    rejectsWith(InvestigationErrorCode.SourceUnsupported, () =>
      new TelemetrySourcesResolver(
        datasources(DatasourceType.Http),
        config([GRAFANA], { prod: ['prod-grafana'] }),
      ).resolve(prod),
    );
  });

  it('resolves logs and traces too, and makes a missing one a problem rather than an error', () => {
    const sources = new TelemetrySourcesResolver(
      datasources(DatasourceType.Http),
      config([PROMETHEUS, LOKI], { prod: ['prod-prom', 'prod-loki'] }),
    ).resolve(prod);

    assert.deepEqual(sources.logs.ok && sources.logs.source.url, 'https://loki.example');
    assert.equal(sources.traces.ok, false);
    assert.equal(
      !sources.traces.ok && sources.traces.problem.errorCode,
      InvestigationErrorCode.SourceMissing,
    );
  });
});
