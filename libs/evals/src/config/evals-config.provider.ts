import type { FactoryProvider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EVALS_CONFIG } from '../evals.tokens';
import type { IEvalsConfig } from './evals-config.model';
import { resolveEvalsConfig } from './evals-config.resolver';

export const evalsConfigProvider: FactoryProvider<IEvalsConfig> = {
  provide: EVALS_CONFIG,
  inject: [ConfigService],
  useFactory: resolveEvalsConfig,
};
