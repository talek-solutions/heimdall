import type { IReferenceAnswer } from '../cases/golden-case.interface';
import { CheckResult, EvalCheck } from '../evals.enums';
import type { ICaseRun } from '../run/case.runner';

export type ICheckResults = Readonly<Record<EvalCheck, CheckResult>>;

/** What code can tell without a model: the outcome, the origin step and the cause vertex. */
export function checkRun(reference: IReferenceAnswer, run: ICaseRun): ICheckResults {
  const conclusion = run.report?.conclusion;
  const check = (expected: string | undefined, actual: string | undefined): CheckResult =>
    expected === undefined
      ? CheckResult.NotApplicable
      : expected === actual
        ? CheckResult.Pass
        : CheckResult.Fail;

  return {
    [EvalCheck.Outcome]: check(reference.outcome, run.report?.outcome),
    [EvalCheck.Origin]: check(reference.origin, conclusion?.origin?.step),
    [EvalCheck.Cause]: check(reference.cause, conclusion?.cause?.vertex),
  };
}
