import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { ConclusionOutcome } from '@heimdall/investigation';
import { EvalError, EvalErrorCode } from '../errors';
import { GoldenCaseLoader, parseCase } from './golden-case.loader';

const GOLDEN = path.resolve(__dirname, '..', '..', 'golden');
const workspace = mkdtempSync(path.join(os.tmpdir(), 'heimdall-golden-'));
const config = {
  judgeModel: 'm',
  goldenDir: GOLDEN,
  calibrationDir: workspace,
  outputDir: workspace,
};

function invalid(yaml: string, pattern: RegExp): void {
  const file = path.join(workspace, `case-${Math.random().toString(16).slice(2)}.yaml`);
  writeFileSync(file, yaml);
  assert.throws(
    () => parseCase(file),
    (error: unknown) =>
      error instanceof EvalError &&
      error.errorCode === EvalErrorCode.CaseInvalid &&
      pattern.test(error.message),
  );
}

describe('Golden cases (replay-and-evals.md, Golden cases)', () => {
  after(() => rmSync(workspace, { recursive: true, force: true }));

  it('loads the three committed cases, each with a manifest that exists and a reference answer', () => {
    const cases = new GoldenCaseLoader(config).load();

    assert.deepEqual(
      cases.map(({ name, reference }) => [name, reference.outcome, reference.cause ?? null]),
      [
        ['error-burst-30s', ConclusionOutcome.CauseFound, 'component:payment-provider'],
        ['healthy-baseline', ConclusionOutcome.NoSignal, null],
        ['increased-latency-1', ConclusionOutcome.CauseFound, 'component:orders-reconcile'],
      ],
    );
    assert.ok(cases.every(({ manifest }) => existsSync(manifest)));
  });

  it('names an unknown case and the ones there are', () => {
    assert.throws(
      () => new GoldenCaseLoader(config).load(['nope']),
      (error: unknown) =>
        error instanceof EvalError &&
        error.errorCode === EvalErrorCode.CaseNotFound &&
        /nope; the cases are error-burst-30s/.test(error.message),
    );
  });

  it('refuses a case by file and field', () => {
    const base = `name: x\ndescription: x\nmanifest: m.yaml\nscenario: s\nanchor: a\nquery: q\nsince: 1m\n`;

    invalid(
      `${base}reference: { outcome: maybe, mechanism: m, evidence: [] }`,
      /reference.outcome must be one of/,
    );
    invalid(
      `${base}reference: { outcome: no-signal, evidence: [] }`,
      /reference.mechanism must be a non-empty string/,
    );
    invalid(
      `${base}env: { ANTHROPIC_API_KEY: x }\nreference: { outcome: no-signal, mechanism: m, evidence: [] }`,
      /env.ANTHROPIC_API_KEY must be an INVESTIGATION_\* or AGENT_\* variable/,
    );
    invalid('[not, a, mapping]', /must be a mapping/);
  });
});
