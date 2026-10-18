import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ConclusionOutcome, type IInvestigationReport } from '@heimdall/investigation';
import { evalsModule, scoreCall, ScriptedJudge } from '../__fixtures__/evals.fixture';
import { EvalErrorCode } from '../errors';
import { JudgeDimension } from '../evals.enums';
import { Judge, JUDGE_SYSTEM_PROMPT, judgeInput } from './judge';

const CONFIG = {
  judgeModel: 'claude-opus-5-5',
  goldenDir: '.',
  calibrationDir: '.',
  outputDir: '.',
};
const REFERENCE = {
  outcome: ConclusionOutcome.CauseFound,
  cause: 'component:orders-reconcile',
  mechanism: 'a long transaction',
  evidence: ['locks'],
};
const INPUT = { reference: REFERENCE, conclusion: { summary: 's' }, citedResults: [] };

async function judge(
  replies: Parameters<typeof scoreCall>[] | 'invalid',
): Promise<{ judge: Judge; model: ScriptedJudge }> {
  const model = new ScriptedJudge(
    replies === 'invalid' ? [scoreCall(3, 1, 1)] : replies.map((reply) => scoreCall(...reply)),
  );
  return { judge: (await evalsModule(model, CONFIG)).get(Judge), model };
}

describe('Judge (replay-and-evals.md, The rubric)', () => {
  it('scores the three dimensions through its one strict tool, from the rubric', async () => {
    const { judge: subject, model } = await judge([[2, 1, 0]]);
    const judgement = await subject.score(INPUT);

    assert.deepEqual(
      Object.values(JudgeDimension).map((name) => judgement.scores?.[name].score),
      [2, 1, 0],
    );
    assert.equal(model.requests[0]?.system, JUDGE_SYSTEM_PROMPT);
    assert.equal(model.requests[0]?.model, 'claude-opus-5-5');
    assert.deepEqual(
      model.requests[0]?.tools?.map(({ name, strict }) => [name, strict]),
      [['score', true]],
    );
    assert.ok(judgement.usage.inputTokens > 0);
  });

  it('sends a score outside 0 to 2 back, and gives up as a judge failure within its budget', async () => {
    const { judge: subject, model } = await judge('invalid');
    const judgement = await subject.score(INPUT);

    assert.equal(judgement.scores, undefined);
    assert.ok(
      judgement.error?.errorCode === EvalErrorCode.JudgeFailed ||
        judgement.error?.errorCode === 'AGENT_BUDGET_EXCEEDED',
      JSON.stringify(judgement.error),
    );
    assert.ok(model.requests.length <= 3);
  });

  it('shows the judge the conclusion and only the results it cites', () => {
    const report = {
      outcome: ConclusionOutcome.CauseFound,
      conclusion: { evidence: ['r2'] },
      results: [{ result: 'r1' }, { result: 'r2' }],
    } as unknown as IInvestigationReport;

    assert.deepEqual(judgeInput(REFERENCE, report).citedResults, [{ result: 'r2' }]);
  });
});
