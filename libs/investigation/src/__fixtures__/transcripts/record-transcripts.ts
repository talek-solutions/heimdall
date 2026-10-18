import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodeTranscript } from '@heimdall/transcript';
import { CI_CASES, recordScripted, transcriptsDir } from './transcript-harness';

/**
 * `npm run transcripts:record`: re-records the committed CI transcripts with the scripted model.
 * Free and deterministic; run it after a deliberate change to what a run produces (ADR 0007).
 * A failure is an unhandled rejection, which Node reports and exits non-zero on.
 */
async function main(): Promise<void> {
  for (const scripted of CI_CASES) {
    writeFileSync(
      join(transcriptsDir(), `${scripted.name}.json`),
      encodeTranscript(await recordScripted(scripted)),
    );
  }
}

void main();
