import type { FactoryProvider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TRANSCRIPT_CONFIG } from '../transcript.tokens';
import type { ITranscriptConfig } from './transcript-config.model';
import { resolveTranscriptConfig } from './transcript-config.resolver';

export const transcriptConfigProvider: FactoryProvider<ITranscriptConfig> = {
  provide: TRANSCRIPT_CONFIG,
  inject: [ConfigService],
  useFactory: resolveTranscriptConfig,
};
