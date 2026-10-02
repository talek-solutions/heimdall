import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { INVESTIGATION_CONFIG } from '../investigation.tokens';
import type { IInvestigationConfig } from './investigation-config.model';
import { resolveInvestigationConfig } from './investigation-config.resolver';

/** Config enters the lib here only; everything else receives `IInvestigationConfig`. */
export const investigationConfigProvider: Provider<IInvestigationConfig> = {
  provide: INVESTIGATION_CONFIG,
  inject: [ConfigService],
  useFactory: (config: ConfigService): IInvestigationConfig => resolveInvestigationConfig(config),
};
