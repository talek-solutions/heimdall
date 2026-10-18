import path from 'node:path';
import type { ConfigService } from '@nestjs/config';
import { heimdallHomeDir } from '@heimdall/core';
import { TranscriptError, TranscriptErrorCode } from '../errors';
import { RecordSetting, TranscriptEnvVariable } from '../transcript.enums';
import type { ITranscriptConfig } from './transcript-config.model';

export const DEFAULT_RUNS_KEEP = 20;
const RUNS_DIRNAME = 'runs';

export function resolveTranscriptConfig(config: ConfigService): ITranscriptConfig {
  const record = config.get<string>(TranscriptEnvVariable.Record) || RecordSetting.On;
  const keep = config.get<string>(TranscriptEnvVariable.RunsKeep) || String(DEFAULT_RUNS_KEEP);
  const replay = config.get<string>(TranscriptEnvVariable.Replay) || undefined;

  if (!(Object.values(RecordSetting) as string[]).includes(record)) {
    throw new TranscriptError(
      TranscriptErrorCode.InvalidConfig,
      `${TranscriptEnvVariable.Record}='${record}' must be ${Object.values(RecordSetting).join(' or ')}`,
    );
  }
  if (!/^\d+$/.test(keep) || Number(keep) < 1) {
    throw new TranscriptError(
      TranscriptErrorCode.InvalidConfig,
      `${TranscriptEnvVariable.RunsKeep}='${keep}' must be a whole number of at least 1`,
    );
  }
  return {
    record: record === RecordSetting.On,
    runsDir: path.resolve(
      config.get<string>(TranscriptEnvVariable.RunsDir) ||
        path.join(heimdallHomeDir(), RUNS_DIRNAME),
    ),
    keep: Number(keep),
    replay:
      replay === undefined
        ? undefined
        : {
            from: path.resolve(replay),
            output: config.get<string>(TranscriptEnvVariable.ReplayOutput) || undefined,
          },
  };
}
