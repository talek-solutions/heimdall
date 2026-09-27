import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TelemetryBackend } from '@heimdall/config';
import { DatasourceType, type ITelemetryDatasourceConfig } from '@heimdall/telemetry';
import { FixtureModeNotice } from './fixture-mode.notice';
import type { Streams } from './streams';

function notice(config: ITelemetryDatasourceConfig): { data: string[]; diagnostics: string[] } {
  const data: string[] = [];
  const diagnostics: string[] = [];
  const streams = {
    write: (text: string) => data.push(text),
    writeDiagnostic: (text: string) => diagnostics.push(text),
  } as unknown as Streams;

  new FixtureModeNotice(config, streams).onApplicationBootstrap();
  return { data, diagnostics };
}

function config(
  prometheus: DatasourceType,
  loki: DatasourceType,
  tempo: DatasourceType,
): ITelemetryDatasourceConfig {
  const usesFixture = [prometheus, loki, tempo].includes(DatasourceType.Fixture);
  return {
    datasources: {
      [TelemetryBackend.Prometheus]: prometheus,
      [TelemetryBackend.Loki]: loki,
      [TelemetryBackend.Tempo]: tempo,
    },
    fixture: usesFixture
      ? { scenario: 'increased-latency-1', anchor: new Date('2026-09-25T08:00:00Z') }
      : undefined,
  };
}

describe('FixtureModeNotice', () => {
  it('says nothing when every backend is live', () => {
    const { data, diagnostics } = notice(config(DatasourceType.Http, DatasourceType.Http, DatasourceType.Http));

    assert.deepEqual(data, []);
    assert.deepEqual(diagnostics, []);
  });

  it('names the fixture backends, scenario and anchor on stderr only', () => {
    const { data, diagnostics } = notice(
      config(DatasourceType.Fixture, DatasourceType.Fixture, DatasourceType.Fixture),
    );

    assert.deepEqual(data, []);
    assert.deepEqual(diagnostics, [
      "heimdall: warning: fixture datasources for prometheus, loki, tempo (scenario 'increased-latency-1', anchor 2026-09-25T08:00:00.000Z): telemetry is synthetic\n",
    ]);
  });

  it('warns when fixture and live backends are mixed', () => {
    const { diagnostics } = notice(config(DatasourceType.Fixture, DatasourceType.Http, DatasourceType.Http));

    assert.match(diagnostics[0] ?? '', /fixture datasources for prometheus \(/);
    assert.match(diagnostics[0] ?? '', /loki, tempo still query live backends/);
  });
});
