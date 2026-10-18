import {
  LLMContentPartType,
  LLMMessageRole,
  type ILLMProviderMessageRequest,
  type ILLMToolResultPart,
} from '@heimdall/llm';
import { canonical, snapshot } from '../format/transcript.codec';
import type {
  IModelExchange,
  ITelemetryExchange,
  ITranscript,
} from '../format/transcript.interface';
import { ReplayOutcome } from '../transcript.enums';
import { diffValues } from './json-diff';
import type { IReplayDiff, IToolResultChange } from './replay-diff.interface';

const LIMIT = 10;
const TOOL_RESULT_PLACEHOLDER = '(tool result)';
/** Varies run to run without meaning anything: never compared. */
const VOLATILE_REPORT_KEYS = ['traceId', 'transcript'];

/**
 * Replay's verdict (ADR 0007): the recorded model's choices were served again, so the run must
 * reproduce every tool result, every source call and the report. What the model was sent besides
 * tool results (the prompt, the tool schemas) is reported, and fails the replay only when strict.
 */
export function compareTranscripts(
  recorded: ITranscript,
  replayed: ITranscript,
  options: { readonly strict: boolean },
): IReplayDiff {
  const toolResults = compareToolResults(recorded.model, replayed.model);
  const telemetry = compareTelemetry(recorded.telemetry, replayed.telemetry);
  const modelInputs = Array.from(
    { length: Math.max(recorded.model.length, replayed.model.length) },
    (_, index) => ({
      call: index + 1,
      changes: diffValues(
        withoutToolResults(recorded.model[index]?.request),
        withoutToolResults(replayed.model[index]?.request),
        LIMIT,
      ),
    }),
  ).filter(({ changes }) => changes.length > 0);
  const report = diffValues(stable(recorded.outcome), stable(replayed.outcome), LIMIT);
  const modelCalls = { recorded: recorded.model.length, replayed: replayed.model.length };
  const diverged =
    toolResults.differing.length > 0 ||
    telemetry.missing.length > 0 ||
    telemetry.extra.length > 0 ||
    report.length > 0 ||
    modelCalls.recorded !== modelCalls.replayed ||
    (options.strict && modelInputs.length > 0);

  return {
    outcome: diverged ? ReplayOutcome.Diverged : ReplayOutcome.Matched,
    strict: options.strict,
    modelCalls,
    modelInputs,
    toolResults,
    telemetry,
    report,
  };
}

function compareToolResults(
  recorded: readonly IModelExchange[],
  replayed: readonly IModelExchange[],
): IReplayDiff['toolResults'] {
  const before = toolResultsOf(recorded);
  const after = toolResultsOf(replayed);
  const names = toolNamesOf(recorded);
  const ids = [...new Set([...before.keys(), ...after.keys()])];
  const differing: IToolResultChange[] = ids.flatMap((callId) => {
    const changes = diffValues(before.get(callId), after.get(callId), LIMIT);
    return changes.length === 0 ? [] : [{ callId, tool: names.get(callId) ?? null, changes }];
  });

  return { compared: before.size, differing };
}

function compareTelemetry(
  recorded: readonly ITelemetryExchange[],
  replayed: readonly ITelemetryExchange[],
): IReplayDiff['telemetry'] {
  const remaining = new Map<string, number>();

  for (const exchange of recorded) {
    const key = keyOf(exchange);
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  const extra: string[] = [];

  for (const exchange of replayed) {
    const key = keyOf(exchange);
    const left = remaining.get(key) ?? 0;

    if (left === 0) {
      extra.push(label(exchange));
    } else {
      remaining.set(key, left - 1);
    }
  }
  const missing = recorded
    .filter((exchange) => {
      const key = keyOf(exchange);
      const left = remaining.get(key) ?? 0;

      if (left === 0) {
        return false;
      }
      remaining.set(key, left - 1);
      return true;
    })
    .map(label);

  return { compared: recorded.length, missing, extra };
}

/** Each tool result once, by the call it answers: every later request repeats the history. */
function toolResultsOf(model: readonly IModelExchange[]): Map<string, unknown> {
  const results = new Map<string, unknown>();

  for (const { request } of model) {
    for (const part of toolResultParts(request)) {
      if (!results.has(part.toolCallId)) {
        results.set(part.toolCallId, parsed(part.content));
      }
    }
  }
  return results;
}

function toolNamesOf(model: readonly IModelExchange[]): Map<string, string> {
  return new Map(
    model.flatMap(({ response }) =>
      (response?.content ?? []).flatMap((part) =>
        part.type === LLMContentPartType.TOOL_CALL ? [[part.id, part.name] as const] : [],
      ),
    ),
  );
}

function toolResultParts(request: ILLMProviderMessageRequest | undefined): ILLMToolResultPart[] {
  return (request?.messages ?? [])
    .filter(({ role, content }) => role === LLMMessageRole.TOOL && Array.isArray(content))
    .flatMap(({ content }) => content as unknown[])
    .filter(
      (part): part is ILLMToolResultPart =>
        typeof part === 'object' &&
        part !== null &&
        (part as { type?: unknown }).type === LLMContentPartType.TOOL_RESULT,
    );
}

function withoutToolResults(request: ILLMProviderMessageRequest | undefined): unknown {
  if (request === undefined) {
    return undefined;
  }
  const copy = snapshot(request);

  for (const part of toolResultParts(copy)) {
    part.content = TOOL_RESULT_PLACEHOLDER;
  }
  return copy;
}

function parsed(content: ILLMToolResultPart['content']): unknown {
  if (typeof content !== 'string') {
    return content;
  }
  try {
    return JSON.parse(content) as unknown;
  } catch {
    return content;
  }
}

/** The outcome without what varies between two equal runs. */
function stable(outcome: ITranscript['outcome']): unknown {
  const copy = snapshot(outcome) as unknown as Record<string, unknown>;
  const report = copy['report'];

  if (typeof report === 'object' && report !== null) {
    const fields = report as Record<string, unknown>;
    const usage = fields['usage'];

    for (const key of VOLATILE_REPORT_KEYS) {
      delete fields[key];
    }
    if (typeof usage === 'object' && usage !== null) {
      delete (usage as Record<string, unknown>)['elapsedMs'];
    }
  }
  return copy;
}

function keyOf(exchange: ITelemetryExchange): string {
  return canonical({
    operation: exchange.operation,
    source: exchange.source,
    request: exchange.request,
  });
}

function label(exchange: ITelemetryExchange): string {
  const { query, traceId } = exchange.request as { query?: unknown; traceId?: unknown };
  return `${exchange.operation} ${String(query ?? traceId ?? canonical(exchange.request))}`;
}
