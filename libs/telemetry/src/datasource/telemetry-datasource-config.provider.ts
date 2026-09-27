import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ITelemetryDatasourceConfig } from './telemetry-datasource-config.model';
import { resolveTelemetryDatasourceConfig } from './telemetry-datasource-config.resolver';
import { TELEMETRY_DATASOURCE_CONFIG } from './telemetry-datasource.tokens';

/** Datasource env vars enter the lib here only; everything else receives the resolved config. */
export const telemetryDatasourceConfigProvider: Provider<ITelemetryDatasourceConfig> = {
  provide: TELEMETRY_DATASOURCE_CONFIG,
  inject: [ConfigService],
  useFactory: (config: ConfigService): ITelemetryDatasourceConfig =>
    resolveTelemetryDatasourceConfig(config),
};
