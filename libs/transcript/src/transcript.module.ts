import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LLM_CALL_INTERCEPTOR } from '@heimdall/llm';
import { TELEMETRY_SOURCE_INTERCEPTOR } from '@heimdall/telemetry';
import { transcriptConfigProvider } from './config/transcript-config.provider';
import { TranscriptSession } from './session/transcript.session';
import { TranscriptStore } from './store/transcript.store';
import { TRANSCRIPT_CONFIG } from './transcript.tokens';

/**
 * Global, so the interceptor hooks of `@heimdall/llm` and `@heimdall/telemetry` find the session
 * wherever those modules are imported (ADR 0007).
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    transcriptConfigProvider,
    TranscriptStore,
    TranscriptSession,
    { provide: LLM_CALL_INTERCEPTOR, useExisting: TranscriptSession },
    { provide: TELEMETRY_SOURCE_INTERCEPTOR, useExisting: TranscriptSession },
  ],
  exports: [
    TRANSCRIPT_CONFIG,
    TranscriptStore,
    TranscriptSession,
    LLM_CALL_INTERCEPTOR,
    TELEMETRY_SOURCE_INTERCEPTOR,
  ],
})
export class TranscriptModule {}
