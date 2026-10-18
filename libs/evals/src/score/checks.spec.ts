import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ConclusionOutcome, type IInvestigationReport } from '@heimdall/investigation';
import { CheckResult, EvalCheck, EvalRunStatus } from '../evals.enums';
import { checkRun } from './checks';

const reference = {
  outcome: ConclusionOutcome.CauseFound,
  origin: 'step:place-order#3',
  cause: 'component:orders-reconcile',
  mechanism: 'm',
  evidence: [],
};

function run(
  conclusion: Record<string, unknown> | undefined,
  outcome = ConclusionOutcome.CauseFound,
) {
  return {
    status: EvalRunStatus.Completed,
    exitCode: 0,
    report: { outcome, conclusion } as unknown as IInvestigationReport,
  };
}

describe('checkRun', () => {
  it('passes the outcome, the origin step and the cause vertex only when they match exactly', () => {
    assert.deepEqual(
      checkRun(
        reference,
        run({ origin: { step: 'step:place-order#3' }, cause: { vertex: 'component:orders-pg' } }),
      ),
      {
        [EvalCheck.Outcome]: CheckResult.Pass,
        [EvalCheck.Origin]: CheckResult.Pass,
        [EvalCheck.Cause]: CheckResult.Fail,
      },
    );
  });

  it('has nothing to check where the reference has no answer, and fails a run that ended in error', () => {
    const noSignal = { outcome: ConclusionOutcome.NoSignal, mechanism: 'm', evidence: [] };

    assert.deepEqual(checkRun(noSignal, run(undefined, ConclusionOutcome.NoSignal)), {
      [EvalCheck.Outcome]: CheckResult.Pass,
      [EvalCheck.Origin]: CheckResult.NotApplicable,
      [EvalCheck.Cause]: CheckResult.NotApplicable,
    });
    assert.equal(
      checkRun(reference, { status: EvalRunStatus.Failed, exitCode: 4 })[EvalCheck.Outcome],
      CheckResult.Fail,
    );
  });
});
