import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import {
  backendsOfType,
  DatasourceType,
  TELEMETRY_DATASOURCE_CONFIG,
  type ITelemetryDatasourceConfig,
} from '@heimdall/telemetry';
import { Streams } from './streams';

/**
 * Fixture data looks exactly like production data, and the costly mistake is an
 * RCA built on it during a real incident. So fixture mode is announced on
 * stderr at every start, deliberately ignoring --quiet (ADR 0014).
 */
@Injectable()
export class FixtureModeNotice implements OnApplicationBootstrap {
  constructor(
    @Inject(TELEMETRY_DATASOURCE_CONFIG) private readonly config: ITelemetryDatasourceConfig,
    private readonly streams: Streams,
  ) {}

  onApplicationBootstrap(): void {
    const { fixture } = this.config;

    if (fixture === undefined) {
      return;
    }
    const fixtures = backendsOfType(this.config, DatasourceType.Fixture);
    const live = backendsOfType(this.config, DatasourceType.Http);
    const mixed =
      live.length === 0
        ? ''
        : `; ${live.join(', ')} still query live backends, so references between signals may not resolve`;

    this.streams.writeDiagnostic(
      `heimdall: warning: fixture datasources for ${fixtures.join(', ')} (scenario '${fixture.scenario}', anchor ${fixture.anchor.toISOString()}): telemetry is synthetic${mixed}\n`,
    );
  }
}
