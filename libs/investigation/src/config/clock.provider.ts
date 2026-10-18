import type { Provider } from '@nestjs/common';
import { TELEMETRY_DATASOURCE_CONFIG, type ITelemetryDatasourceConfig } from '@heimdall/telemetry';
import { TranscriptPin, TranscriptSession } from '@heimdall/transcript';
import { CLOCK } from '../investigation.tokens';
import type { IClock } from './investigation-config.model';

/**
 * In fixture mode "now" is the scenario's anchor, or relative windows would not line up with the
 * synthetic timeline (ADR 0014). A recorded run keeps the "now" it used, and a replay reuses it
 * (ADR 0007).
 */
export const clockProvider: Provider<IClock> = {
  provide: CLOCK,
  inject: [TELEMETRY_DATASOURCE_CONFIG, { token: TranscriptSession, optional: true }],
  useFactory: ({ fixture }: ITelemetryDatasourceConfig, session?: TranscriptSession): IClock => {
    const now = (): Date =>
      fixture === undefined ? new Date() : new Date(fixture.anchor.getTime());

    return session === undefined
      ? { now }
      : { now: () => new Date(session.pin(TranscriptPin.Now, () => now().toISOString())) };
  },
};
