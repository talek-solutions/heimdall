import type { Provider } from '@nestjs/common';
import type { ITelemetryDatasourceConfig } from '../datasource/telemetry-datasource-config.model';
import { TELEMETRY_DATASOURCE_CONFIG } from '../datasource/telemetry-datasource.tokens';
import { FIXTURE_SCENARIO, FIXTURE_SCENARIOS_ROOT } from './fixture.tokens';
import { ScenarioLoader } from './scenario/scenario.loader';
import type { IScenario } from './scenario/scenario.model';
import { defaultScenariosRoot } from './scenario/scenarios-root';

export const fixtureScenariosRootProvider: Provider<string> = {
  provide: FIXTURE_SCENARIOS_ROOT,
  useFactory: (): string => defaultScenariosRoot(),
};

/**
 * Loaded at bootstrap when any backend is a fixture, so a missing or broken
 * scenario fails before a command runs. No I/O otherwise.
 */
export const fixtureScenarioProvider: Provider<IScenario | undefined> = {
  provide: FIXTURE_SCENARIO,
  inject: [TELEMETRY_DATASOURCE_CONFIG, FIXTURE_SCENARIOS_ROOT, ScenarioLoader],
  useFactory: async (
    config: ITelemetryDatasourceConfig,
    root: string,
    loader: ScenarioLoader,
  ): Promise<IScenario | undefined> =>
    config.fixture === undefined ? undefined : loader.load(root, config.fixture.scenario),
};
