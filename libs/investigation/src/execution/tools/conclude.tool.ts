import { ToolAccess, toolError, toolOk, type IAgentTool } from '@heimdall/agent';
import { InvestigationError, InvestigationErrorCode } from '../../errors';
import { ConclusionOutcome, MitigationTier, ResultVerdict } from '../conclusion/conclusion.enums';
import type {
  IConclusion,
  IConclusionVerdict,
  IMitigation,
} from '../conclusion/conclusion.interface';
import type { ConclusionValidator } from '../conclusion/conclusion.validator';
import type { ExecutionSession } from '../execution.session';
import { InvestigationTool } from './investigation-tool.enum';
import { invalid, nonEmptyString, object, oneOf, type Fields } from './tool-input';

const OUTCOMES = Object.values(ConclusionOutcome);
const VERDICTS = Object.values(ResultVerdict);
const TIERS = Object.values(MitigationTier);

/** The stop tool: one rejection goes back to the agent, a second fails the run (ADR 0018). */
export function concludeTool(
  session: ExecutionSession,
  validator: ConclusionValidator,
): IAgentTool<IConclusion> {
  return {
    name: InvestigationTool.Conclude,
    description:
      'End the investigation. Give a verdict for every result you rely on, cite result ids as evidence, and for a cause propose mitigations in three tiers with their trade-offs. Code checks the conclusion against the results; a rejected one comes back once to be fixed.',
    inputSchema: {
      type: 'object',
      properties: {
        outcome: { type: 'string', enum: OUTCOMES },
        summary: { type: 'string', description: 'Two or three sentences for the engineer' },
        cause: {
          type: 'object',
          properties: {
            vertex: {
              type: 'string',
              description: 'The vertex at fault, e.g. component:payment-provider',
            },
            mechanism: { type: 'string', description: 'What happened there, in one sentence' },
          },
          required: ['vertex', 'mechanism'],
        },
        origin: {
          type: 'object',
          description: 'The step the fault starts at, by the origin rule',
          properties: {
            step: { type: 'string' },
            uncertain: {
              type: 'boolean',
              description: 'True when a step without data could be the origin',
            },
          },
          required: ['step', 'uncertain'],
        },
        verdicts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              result: { type: 'string', description: 'A result id, e.g. r3' },
              verdict: { type: 'string', enum: VERDICTS },
              reason: { type: 'string' },
            },
            required: ['result', 'verdict', 'reason'],
          },
        },
        evidence: {
          type: 'array',
          items: { type: 'string' },
          description: 'Result ids the conclusion rests on',
        },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        mitigations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              tier: { type: 'string', enum: TIERS },
              action: { type: 'string' },
              tradeoff: { type: 'string' },
            },
            required: ['tier', 'action', 'tradeoff'],
          },
        },
      },
      required: ['outcome', 'summary', 'verdicts', 'evidence', 'confidence', 'mitigations'],
    },
    access: ToolAccess.ReadOnly,
    parse: parseConclusion,
    execute: async (conclusion) => {
      const problems = validator.validate(conclusion, session);

      if (problems.length === 0) {
        return toolOk({ accepted: true }, `${conclusion.outcome} accepted`);
      }
      session.rejections += 1;
      if (session.rejections > 1) {
        throw new InvestigationError(
          InvestigationErrorCode.ConclusionInvalid,
          `the conclusion was rejected twice: ${problems.join('; ')}`,
        );
      }
      return toolError(InvestigationErrorCode.ConclusionInvalid, problems.join('; '));
    },
  };
}

function parseConclusion(input: unknown) {
  const fields = object(input);

  if (fields === undefined) {
    return invalid<IConclusion>('the conclusion must be an object');
  }
  const { outcome, summary, cause, origin, verdicts, evidence, confidence, mitigations } = fields;

  if (!oneOf(OUTCOMES, outcome)) {
    return invalid<IConclusion>(`outcome must be one of ${OUTCOMES.join(', ')}`);
  }
  if (!nonEmptyString(summary)) {
    return invalid<IConclusion>('summary must say what happened');
  }
  if (typeof confidence !== 'number' || !(confidence >= 0 && confidence <= 1)) {
    return invalid<IConclusion>('confidence must be a number from 0 to 1');
  }
  const parsedCause = parseCause(cause);
  const parsedOrigin = parseOrigin(origin);
  const parsedVerdicts = list(verdicts, parseVerdict);
  const parsedMitigations = list(mitigations, parseMitigation);

  if (parsedCause === null || parsedOrigin === null) {
    return invalid<IConclusion>(
      'cause needs vertex and mechanism; origin needs step and uncertain',
    );
  }
  if (parsedVerdicts === undefined) {
    return invalid<IConclusion>(
      `each verdict needs a result id, one of ${VERDICTS.join(', ')}, and a reason`,
    );
  }
  if (parsedMitigations === undefined) {
    return invalid<IConclusion>(
      `each mitigation needs a tier (${TIERS.join(', ')}), an action and its trade-off`,
    );
  }
  if (!Array.isArray(evidence) || !evidence.every(nonEmptyString)) {
    return invalid<IConclusion>('evidence must be a list of result ids');
  }
  return {
    ok: true as const,
    input: {
      outcome,
      summary,
      ...(parsedCause === undefined ? {} : { cause: parsedCause }),
      ...(parsedOrigin === undefined ? {} : { origin: parsedOrigin }),
      verdicts: parsedVerdicts,
      evidence: [...new Set(evidence)],
      confidence,
      mitigations: parsedMitigations,
    },
  };
}

/** `undefined` when absent, `null` when malformed. */
function parseCause(value: unknown): IConclusion['cause'] | null {
  if (value === undefined) {
    return undefined;
  }
  const fields = object(value);
  const vertex = fields?.['vertex'];
  const mechanism = fields?.['mechanism'];

  return nonEmptyString(vertex) && nonEmptyString(mechanism) ? { vertex, mechanism } : null;
}

function parseOrigin(value: unknown): IConclusion['origin'] | null {
  if (value === undefined) {
    return undefined;
  }
  const fields = object(value);
  const step = fields?.['step'];
  const uncertain = fields?.['uncertain'];

  return nonEmptyString(step) && typeof uncertain === 'boolean' ? { step, uncertain } : null;
}

function parseVerdict(fields: Fields): IConclusionVerdict | undefined {
  const { result, verdict, reason } = fields;
  return nonEmptyString(result) && oneOf(VERDICTS, verdict) && typeof reason === 'string'
    ? { result, verdict, reason }
    : undefined;
}

function parseMitigation(fields: Fields): IMitigation | undefined {
  const { tier, action, tradeoff } = fields;
  return oneOf(TIERS, tier) && nonEmptyString(action) && nonEmptyString(tradeoff)
    ? { tier, action, tradeoff }
    : undefined;
}

function list<T>(value: unknown, parse: (fields: Fields) => T | undefined): T[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const parsed = value.map((entry) => {
    const fields = object(entry);
    return fields === undefined ? undefined : parse(fields);
  });
  return parsed.every((entry) => entry !== undefined) ? (parsed as T[]) : undefined;
}
