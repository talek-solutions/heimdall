import { Inject, Injectable } from '@nestjs/common';
import {
  AgentOutcome,
  AgentRunner,
  ToolAccess,
  toolOk,
  ToolRepository,
  type IAgentTool,
} from '@heimdall/agent';
import { isHeimdallError, type ErrorResponse } from '@heimdall/core';
import type { IInvestigationReport } from '@heimdall/investigation';
import { LLMMessageRole } from '@heimdall/llm';
import type { IReferenceAnswer } from '../cases/golden-case.interface';
import type { IEvalsConfig } from '../config/evals-config.model';
import { EvalErrorCode } from '../errors';
import { JudgeDimension } from '../evals.enums';
import { EVALS_CONFIG } from '../evals.tokens';

export interface IDimensionScore {
  /** 0, 1 or 2. */
  readonly score: number;
  readonly reason: string;
}

export type IJudgeScores = Readonly<Record<JudgeDimension, IDimensionScore>>;

/** Everything the judge sees: never the whole transcript, only what the conclusion rests on. */
export interface IJudgeInput {
  readonly reference: IReferenceAnswer;
  readonly conclusion: unknown;
  readonly citedResults: readonly unknown[];
}

export interface IJudgement {
  readonly scores?: IJudgeScores | undefined;
  readonly error?: ErrorResponse | undefined;
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number };
}

const AGENT_NAME = 'heimdall.judge';
const SCORE_TOOL = 'score';
const SCORES = [0, 1, 2];
const JUDGE_BUDGET = { maxTurns: 3, maxToolCalls: 3, maxToolCost: 1 };

/** Byte-stable, so it stays a cached prefix (ADR 0004). `.docs/design/replay-and-evals.md`, The rubric. */
export const JUDGE_SYSTEM_PROMPT = `You grade a root-cause investigation against a reference answer written by an engineer who knows the incident. Score three dimensions, each 0, 1 or 2, with a one-sentence reason, then call ${SCORE_TOOL}.

${JudgeDimension.Component}: did the conclusion name the component at fault?
- 2: the reference's cause, or the same component under another id.
- 1: a vertex on the way to it, or one that shares the failure (the database a job is locking, instead of the job).
- 0: another component, or none when the reference has one.

${JudgeDimension.Mechanism}: is the explanation the reference's mechanism?
- 2: the same mechanism, in any words.
- 1: the right chain of symptoms with the wrong or a missing root.
- 0: a different mechanism, or none.

${JudgeDimension.Evidence}: do the cited results show what the conclusion claims?
- 2: the claim follows from the cited results.
- 1: they show part of it; a key step is asserted without a result that shows it.
- 0: they do not support it, or nothing is cited.

When the reference expects no signal, ${JudgeDimension.Component} and ${JudgeDimension.Mechanism} are 2 when the conclusion finds nothing wrong without inventing a cause, and 0 otherwise; ${JudgeDimension.Evidence} is 2 when it cites healthy results for what it checked.

Judge only from what you are given. Do not reward length, confidence or style.`;

/**
 * The judge of the golden set (ADR 0007): an agent run with one tool, `score`. Its scores are
 * trusted only once calibrated against hand scores (`Calibrator`).
 */
@Injectable()
export class Judge {
  constructor(
    private readonly agent: AgentRunner,
    @Inject(EVALS_CONFIG) private readonly config: IEvalsConfig,
  ) {}

  async score(input: IJudgeInput): Promise<IJudgement> {
    const stop = scoreTool();

    try {
      const run = await this.agent.run({
        agent: AGENT_NAME,
        model: this.config.judgeModel,
        system: JUDGE_SYSTEM_PROMPT,
        messages: [{ role: LLMMessageRole.USER, content: JSON.stringify(input, null, 2) }],
        tools: ToolRepository.of([stop]),
        stopTool: stop,
        budget: JUDGE_BUDGET,
      });
      const usage = { inputTokens: run.usage.inputTokens, outputTokens: run.usage.outputTokens };

      return run.outcome === AgentOutcome.Completed
        ? { scores: run.output, usage }
        : {
            error: {
              errorCode: EvalErrorCode.JudgeFailed,
              message: `the judge ended without a score (${run.reason})`,
            },
            usage,
          };
    } catch (error) {
      return {
        error: isHeimdallError(error)
          ? error.toResponse()
          : { errorCode: EvalErrorCode.JudgeFailed, message: String(error) },
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }
  }
}

/** The reference, the conclusion, and the results the conclusion cites. */
export function judgeInput(reference: IReferenceAnswer, report: IInvestigationReport): IJudgeInput {
  const cited = new Set(report.conclusion?.evidence ?? []);

  return {
    reference,
    conclusion: report.conclusion ?? { outcome: report.outcome, ended: report.agentReason },
    citedResults: report.results.filter((result) => cited.has(result.result)),
  };
}

function scoreTool(): IAgentTool<IJudgeScores> {
  const dimension = {
    type: 'object',
    properties: {
      score: { type: 'integer', enum: SCORES },
      reason: { type: 'string', description: 'One sentence' },
    },
    required: ['score', 'reason'],
  } as const;
  const dimensions = Object.values(JudgeDimension);

  return {
    name: SCORE_TOOL,
    description: 'Record the three scores and their reasons. This ends the grading.',
    inputSchema: {
      type: 'object',
      properties: Object.fromEntries(dimensions.map((name) => [name, dimension])),
      required: dimensions,
    },
    access: ToolAccess.ReadOnly,
    parse: (input) => {
      const fields =
        typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
      const scores: Partial<Record<JudgeDimension, IDimensionScore>> = {};

      for (const name of dimensions) {
        const entry = fields[name] as { score?: unknown; reason?: unknown } | undefined;

        if (
          typeof entry?.score !== 'number' ||
          !SCORES.includes(entry.score) ||
          typeof entry.reason !== 'string' ||
          entry.reason.trim() === ''
        ) {
          return { ok: false, problem: `${name} needs a score of 0, 1 or 2 and a reason` };
        }
        scores[name] = { score: entry.score, reason: entry.reason.trim() };
      }
      return { ok: true, input: scores as IJudgeScores };
    },
    execute: async (scores) =>
      toolOk(
        { recorded: true },
        dimensions.map((name) => `${name} ${scores[name].score}`).join(', '),
        0,
      ),
  };
}
