import type { Provider } from '@nestjs/common';
import { TELEMETRY_DATASOURCE_CONFIG, type ITelemetryDatasourceConfig } from '@heimdall/telemetry';
import { CLOCK } from '../investigation.tokens';
import type { IClock } from './investigation-config.model';

/**
 * In fixture mode "now" is the scenario's anchor, or relative windows would not line up
 * with the synthetic timeline (ADR 0014).
 */
export const clockProvider: Provider<IClock> = {
  provide: CLOCK,
  inject: [TELEMETRY_DATASOURCE_CONFIG],
  useFactory: ({ fixture }: ITelemetryDatasourceConfig): IClock =>
    fixture === undefined
      ? { now: (): Date => new Date() }
      : { now: (): Date => new Date(fixture.anchor.getTime()) },
};
