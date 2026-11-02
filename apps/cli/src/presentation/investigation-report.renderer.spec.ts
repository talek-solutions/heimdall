import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describe, it } from 'node:test';
import { InconclusiveReason } from '@heimdall/agent';
import { ConclusionOutcome, type IInvestigationReport } from '@heimdall/investigation';
import { assertGolden, repoRoot } from '../__fixtures__/golden';
import { renderReport } from './investigation-report.renderer';

const TRANSCRIPTS = join(repoRoot(), 'libs', 'investigation', 'src', '__fixtures__', 'transcripts');
const GOLDEN = join(repoRoot(), 'apps', 'cli', 'src', 'presentation', '__golden__');

/** The report a committed CI transcript ended with: recorded by the scripted model, never a real one. */
function recorded(file: string): IInvestigationReport {
  const transcript = JSON.parse(readFileSync(join(TRANSCRIPTS, file), 'utf8')) as {
    readonly outcome: { readonly report: IInvestigationReport };
  };
  return transcript.outcome.report;
}

describe('renderReport: the text report, pinned by golden files', () => {
  for (const file of readdirSync(TRANSCRIPTS).filter((name) => name.endsWith('.json'))) {
    const name = basename(file, '.json');

    it(`renders ${name} as its golden file`, () => {
      assertGolden(join(GOLDEN, `${name}.txt`), renderReport(recorded(file)));
    });
  }

  it('says why when the agent ended without a conclusion', () => {
    const report = recorded('increased-latency-1.json');
    const text = renderReport({
      ...report,
      outcome: ConclusionOutcome.Inconclusive,
      conclusion: undefined,
      agentReason: InconclusiveReason.NoStopCall,
      blindSpots: [],
    });

    assert.match(text, /the agent ended without a conclusion \(no-stop-call\)/);
    assert.doesNotMatch(text, /^mitigations/m);
    assert.doesNotMatch(text, /^evidence/m);
  });

  it('prints times with seconds when the window is short', () => {
    assert.match(renderReport(recorded('error-burst-30s.json')), /spike at \d\d:\d\d:\d\d/);
    assert.match(renderReport(recorded('increased-latency-1.json')), /step up at \d\d:\d\d,/);
  });
});
