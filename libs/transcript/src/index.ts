import 'reflect-metadata';

export type { ITranscriptConfig } from './config/transcript-config.model';
export { DEFAULT_RUNS_KEEP, resolveTranscriptConfig } from './config/transcript-config.resolver';
export * from './errors';
export { isRecordedVariable, recordedVariables } from './format/environment';
export { canonical, decodeTranscript, encodeTranscript } from './format/transcript.codec';
export type * from './format/transcript.interface';
export { diffValues, type IValueChange } from './replay/json-diff';
export type * from './replay/replay-diff.interface';
export { compareTranscripts } from './replay/replay.comparison';
export {
  TranscriptSession,
  type ITranscriptBegin,
  type ITranscriptSaved,
} from './session/transcript.session';
export { TranscriptStore } from './store/transcript.store';
export * from './transcript.enums';
export { TranscriptModule } from './transcript.module';
export { TRANSCRIPT_CONFIG } from './transcript.tokens';
