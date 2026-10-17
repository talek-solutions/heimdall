import type { FactoryProvider } from '@nestjs/common';
import {
  HEIMDALL_CONFIG,
  Scrubber,
  type IHeimdallConfig,
  type IRedactionConfig,
} from '@heimdall/config';
import { Redactor } from '../redaction/redactor';
import { REDACTOR } from './telemetry-source.tokens';

/** What applies with no config loaded (fixture runs, specs): every scrubber, nothing extra. */
export const DEFAULT_REDACTION: IRedactionConfig = {
  scrubbers: Object.values(Scrubber),
  additionalPatterns: [],
};

/** The config's `redaction`, validated at load; the defaults when no config is loaded. */
export const redactorProvider: FactoryProvider<Redactor> = {
  provide: REDACTOR,
  useFactory: (config?: IHeimdallConfig) => new Redactor(config?.redaction ?? DEFAULT_REDACTION),
  inject: [{ token: HEIMDALL_CONFIG, optional: true }],
};
