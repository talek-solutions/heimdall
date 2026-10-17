import 'reflect-metadata';
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { AuthScheme } from '@heimdall/config';
import { ExpectationKind, IndicatorRole } from '@heimdall/core/manifest';
import { checkoutPlan } from '../../__fixtures__/execution.fixture';
import type { IRoleResult } from '../checks/check-result.interface';
import { ExecutionSession } from '../execution.session';
import { ObjectiveVerdict, PreliminarySignal } from '../health/health.enums';
import { ConclusionOutcome, MitigationTier, ResultVerdict } from './conclusion.enums';
import type { IConclusion } from './conclusion.interface';
import { ConclusionValidator } from './conclusion.validator';

const validator = new ConclusionValidator();

function result(
  id: string,
  subject: string,
  signal: PreliminarySignal,
  verdict: ObjectiveVerdict | null = null,
): IRoleResult {
  return {
    result: id,
    check: null,
    indicator: `indicator:${subject}@1`,
    subject,
    role: IndicatorRole.Errors,
    expectation: verdict === null ? ExpectationKind.Baseline : ExpectationKind.Slo,
    verdict,
    bounds: null,
    signal,
    direction: null,
    unit: '',
    window: { start: '', end: '', stepSeconds: 1 },
    baseline: null,
    peak: null,
    longestRun: 0,
    onset: null,
    breachOnset: null,
    coverage: 1,
    zoom: null,
    problem: null,
  };
}

const MITIGATIONS = [{ tier: MitigationTier.Immediate, action: 'Fail over', tradeoff: 'Fees' }];

describe('ConclusionValidator', () => {
  let session: ExecutionSession;

  before(async () => {
    const { plan, graph } = await checkoutPlan();

    session = new ExecutionSession(
      graph,
      plan,
      { url: 'x', timeoutMs: 1, auth: { scheme: AuthScheme.None } },
      {},
    );
    session.record(result('r1', 'step:place-order#1', PreliminarySignal.Anomalous));
    session.record(result('r2', 'step:place-order#4', PreliminarySignal.Anomalous));
    session.record(result('r3', 'step:place-order#5', PreliminarySignal.Anomalous));
    session.record(result('r4', 'step:place-order#3', PreliminarySignal.NoData));
    session.record(
      result('r5', 'flow:place-order', PreliminarySignal.Anomalous, ObjectiveVerdict.Met),
    );
  });

  const sound: IConclusion = {
    outcome: ConclusionOutcome.CauseFound,
    summary: 'The provider answers 502.',
    cause: { vertex: 'component:payment-provider', mechanism: '502 from the provider' },
    origin: { step: 'step:place-order#5', uncertain: false },
    verdicts: [
      { result: 'r1', verdict: ResultVerdict.Unhealthy, reason: 'errors' },
      { result: 'r2', verdict: ResultVerdict.Unhealthy, reason: 'errors' },
      { result: 'r3', verdict: ResultVerdict.Unhealthy, reason: 'errors' },
      { result: 'r4', verdict: ResultVerdict.NoData, reason: 'no series' },
      { result: 'r5', verdict: ResultVerdict.Healthy, reason: 'within the SLO' },
    ],
    evidence: ['r1', 'r3'],
    confidence: 0.8,
    mitigations: MITIGATIONS,
  };

  it('accepts a conclusion that agrees with the results and the origin rule', () => {
    assert.deepEqual(validator.validate(sound, session), []);
  });

  it('wants a cause, evidence and mitigations for cause-found', () => {
    const { cause: _cause, ...withoutCause } = sound;

    assert.deepEqual(
      validator.validate({ ...withoutCause, evidence: [], mitigations: [] }, session),
      [
        'a cause-found conclusion names its cause',
        'a cause-found conclusion cites at least one result',
        'a cause-found conclusion proposes mitigations',
      ],
    );
  });

  it('rejects an unknown cause vertex and unknown result ids', () => {
    assert.deepEqual(
      validator.validate(
        {
          ...sound,
          cause: { vertex: 'component:nowhere', mechanism: 'x' },
          evidence: ['r1', 'r99'],
        },
        session,
      ),
      ["the cause 'component:nowhere' is not a vertex of the system", 'no result is called r99'],
    );
  });

  it('keeps objective verdicts, and never lets no-data be healthy or unhealthy', () => {
    const verdicts = sound.verdicts.map((verdict) =>
      verdict.result === 'r5' || verdict.result === 'r4'
        ? { ...verdict, verdict: ResultVerdict.Unhealthy }
        : verdict,
    );

    assert.deepEqual(validator.validate({ ...sound, verdicts }, session), [
      'r4 is no-data: it has no data',
      'r5 is healthy: its slo is met',
    ]);
  });

  it('applies the origin rule: the deepest unhealthy hop of a sync flow', () => {
    const [problem] = validator.validate(
      { ...sound, origin: { step: 'step:place-order#4', uncertain: false } },
      session,
    );

    assert.match(
      problem ?? '',
      /fault starts at step:place-order#5 \(the deepest unhealthy step\)/,
    );
    assert.deepEqual(
      validator.validate(
        { ...sound, origin: { step: 'step:place-order#4', uncertain: true } },
        session,
      ),
      [],
    );
  });

  it('does not let no-signal stand next to unhealthy verdicts', () => {
    const [problem] = validator.validate(
      { ...sound, outcome: ConclusionOutcome.NoSignal, origin: undefined },
      session,
    );

    assert.match(problem ?? '', /no-signal contradicts unhealthy results r1, r2, r3/);
  });
});
