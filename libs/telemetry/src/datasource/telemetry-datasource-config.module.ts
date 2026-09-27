import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { fixtureScenarioProvider, fixtureScenariosRootProvider } from '../fixture/fixture.providers';
import { FIXTURE_SCENARIO } from '../fixture/fixture.tokens';
import { ScenarioLoader } from '../fixture/scenario/scenario.loader';
import { telemetryDatasourceConfigProvider } from './telemetry-datasource-config.provider';
import { TELEMETRY_DATASOURCE_CONFIG } from './telemetry-datasource.tokens';

/**
 * The resolved datasource selection and, in fixture mode, the loaded scenario;
 * no connectors. The CLI imports this so a bad fixture setup fails at startup and
 * fixture mode is announced, without reaching for the raw `./connectors` surface
 * (ADR 0008).
 */
@Module({
  imports: [ConfigModule],
  providers: [
    telemetryDatasourceConfigProvider,
    ScenarioLoader,
    fixtureScenariosRootProvider,
    fixtureScenarioProvider,
  ],
  exports: [TELEMETRY_DATASOURCE_CONFIG, FIXTURE_SCENARIO],
})
export class TelemetryDatasourceConfigModule {}
