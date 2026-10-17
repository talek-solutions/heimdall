import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  LLMContentPartType,
  LLMFinishReason,
  LLMMessageRole,
  LLMToolChoiceType,
  type ILLMMessage,
  type ILLMToolResultPart,
} from '@heimdall/llm';
import {
  AGENT_CONFIG_FIXTURE,
  FakeClock,
  ScriptedLlmProvider,
  call,
  concludeTool,
  echoTool,
  mutatingTool,
  reply,
  runRequest,
  runner,
  text,
  throwingTool,
} from '../__fixtures__/agent.fixture';
import {
  AgentEventType,
  AgentOutcome,
  BudgetDimension,
  InconclusiveReason,
  ToolResultStatus,
} from '../enums';
import { AgentBudgetExceededError, AgentError, AgentErrorCode } from '../errors';
import type { IAgentTool } from '../tools/agent-tool.interface';
import { toolOk } from '../tools/tool-results';
import { ToolRepository } from '../tools/tool.repository';
import type { IAgentEvent } from './agent-event.interface';

const CONCLUDE = call('c-stop', 'conclude', { answer: 'payments' });

/** The tool results the runner sent in the last message of request `index`. */
function results(llm: ScriptedLlmProvider, index: number): ILLMToolResultPart[] {
  const last = llm.requests[index]?.messages.at(-1);

  assert.equal(last?.role, LLMMessageRole.TOOL);
  return (last?.content as ILLMToolResultPart[]) ?? [];
}

function lastUserText(llm: ScriptedLlmProvider, index: number): string {
  const last = llm.requests[index]?.messages.at(-1);
  const [part] = Array.isArray(last?.content) ? last.content : [];

  assert.equal(last?.role, LLMMessageRole.USER);
  return part?.type === LLMContentPartType.TEXT ? part.text : '';
}

async function budgetError(promise: Promise<unknown>): Promise<AgentBudgetExceededError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof AgentBudgetExceededError, String(error));
    return error;
  }
  assert.fail('the run did not exceed its budget');
}

describe('AgentRunner', () => {
  describe('the loop', () => {
    it('runs tools, then ends with the stop tool input as its output', async () => {
      const llm = new ScriptedLlmProvider([
        reply([call('c1', 'echo', { text: 'hi' })]),
        reply([CONCLUDE]),
      ]);
      const events: IAgentEvent[] = [];
      const result = await runner(llm).run(runRequest({ onEvent: (event) => events.push(event) }));

      assert.equal(result.outcome, AgentOutcome.Completed);
      assert.deepEqual(result.outcome === AgentOutcome.Completed && result.output, {
        answer: 'payments',
      });
      assert.deepEqual(JSON.parse(String(results(llm, 1)[0]?.content)), { echoed: 'hi' });
      assert.equal(result.usage.turns, 2);
      assert.equal(result.usage.toolCalls, 2);
      assert.equal(result.usage.inputTokens, 2_000);
      assert.equal(result.transcript.messages.at(-1)?.role, LLMMessageRole.TOOL);
      assert.equal(result.traceId, undefined, 'no SDK is registered, so there is no trace to link');
      assert.deepEqual(
        events.map((event) => event.type),
        [
          AgentEventType.TurnStarted,
          AgentEventType.ModelResponded,
          AgentEventType.ToolCalled,
          AgentEventType.ToolCompleted,
          AgentEventType.TurnStarted,
          AgentEventType.ModelResponded,
          AgentEventType.ToolCalled,
          AgentEventType.ToolCompleted,
          AgentEventType.Finished,
        ],
      );
    });

    it('sends tools through the provider port, with auto tool choice and its request options', async () => {
      const llm = new ScriptedLlmProvider([reply([CONCLUDE])]);

      await runner(llm).run(runRequest({ fallbackOnRefusal: true }));
      const [request] = llm.requests;

      assert.deepEqual(
        request?.tools?.map((tool) => [tool.name, tool.strict]),
        [
          ['conclude', true],
          ['echo', true],
        ],
      );
      assert.deepEqual(request?.toolChoice, { type: LLMToolChoiceType.AUTO });
      assert.deepEqual(request?.providerOptions, { systemCacheControl: { type: 'ephemeral' } });
      assert.equal(request?.system, 'You test.');
      assert.equal(request?.fallbackOnRefusal, true);
    });

    it('only ever appends to the history it sends', async () => {
      const llm = new ScriptedLlmProvider([
        reply([call('c1', 'echo', { text: 'a' })]),
        reply([text('thinking out loud')], LLMFinishReason.STOP),
        reply([call('c2', 'nope', {})]),
        reply([CONCLUDE]),
      ]);

      await runner(llm).run(runRequest());

      for (let index = 1; index < llm.requests.length; index += 1) {
        const previous = llm.requests[index - 1]?.messages ?? [];
        const current = llm.requests[index]?.messages ?? [];

        assert.ok(current.length > previous.length, `request ${index} grew`);
        assert.deepEqual(
          current.slice(0, previous.length),
          previous,
          `request ${index} kept its prefix`,
        );
      }
    });

    it('echoes reasoning, signature included, back in the assistant turn it came from', async () => {
      const reasoning = {
        type: LLMContentPartType.REASONING,
        text: 'check echo',
        signature: 'sig-1',
      } as const;
      const llm = new ScriptedLlmProvider([
        reply([reasoning, call('c1', 'echo', { text: 'a' })]),
        reply([CONCLUDE]),
      ]);

      await runner(llm).run(runRequest());
      const assistant = llm.requests[1]?.messages.find(
        (message: ILLMMessage) => message.role === LLMMessageRole.ASSISTANT,
      );

      assert.deepEqual(Array.isArray(assistant?.content) && assistant.content[0], reasoning);
    });

    it('throws when the stop tool is not among the run tools', async () => {
      await assert.rejects(
        runner(new ScriptedLlmProvider([])).run(
          runRequest({ tools: ToolRepository.of([echoTool()]) }),
        ),
        (error: unknown) =>
          error instanceof AgentError && error.errorCode === AgentErrorCode.StopToolMissing,
      );
    });
  });

  describe('tool calls', () => {
    it('answers every call of one reply in one tool turn, in call order, at most `toolConcurrency` at a time', async () => {
      let running = 0;
      let peak = 0;
      const slow: IAgentTool<{ readonly id: string }> = {
        ...echoTool(),
        name: 'slow',
        parse: (input) => ({ ok: true, input: input as { id: string } }),
        execute: async ({ id }) => {
          running += 1;
          peak = Math.max(peak, running);
          await new Promise((resolve) => setTimeout(resolve, 5));
          running -= 1;
          return toolOk({ id }, id);
        },
      };
      const stop = concludeTool();
      const llm = new ScriptedLlmProvider([
        reply([
          call('a', 'slow', { id: 'a' }),
          call('b', 'slow', { id: 'b' }),
          call('c', 'slow', { id: 'c' }),
        ]),
        reply([CONCLUDE]),
      ]);

      await runner(llm).run(runRequest({ tools: ToolRepository.of([slow, stop]), stopTool: stop }));

      assert.deepEqual(
        results(llm, 1).map((part) => part.toolCallId),
        ['a', 'b', 'c'],
      );
      assert.equal(peak, AGENT_CONFIG_FIXTURE.toolConcurrency);
    });

    it('returns an invalid input to the model without running the tool', async () => {
      let ran = false;
      const echo = echoTool(1, () => {
        ran = true;
      });
      const stop = concludeTool();
      const llm = new ScriptedLlmProvider([
        reply([call('c1', 'echo', { text: '' })]),
        reply([CONCLUDE]),
      ]);

      await runner(llm).run(runRequest({ tools: ToolRepository.of([echo, stop]), stopTool: stop }));
      const [result] = results(llm, 1);

      assert.equal(ran, false);
      assert.equal(result?.isError, true);
      assert.deepEqual(JSON.parse(String(result?.content)), {
        errorCode: AgentErrorCode.InvalidToolInput,
        message: 'text must be a non-empty string',
      });
    });

    it('returns an unknown tool and a failing tool as error results, naming what exists', async () => {
      const stop = concludeTool();
      const llm = new ScriptedLlmProvider([
        reply([call('c1', 'nope', {}), call('c2', 'explode', {})]),
        reply([CONCLUDE]),
      ]);

      await runner(llm).run(
        runRequest({
          tools: ToolRepository.of([echoTool(), throwingTool(), stop]),
          stopTool: stop,
        }),
      );
      const [unknown, failed] = results(llm, 1).map((part) => JSON.parse(String(part.content)));

      assert.deepEqual(unknown, {
        errorCode: AgentErrorCode.UnknownTool,
        message: "no tool named 'nope'; the tools are conclude, echo, explode",
      });
      assert.deepEqual(failed, {
        errorCode: AgentErrorCode.ToolFailed,
        message: 'backend unreachable',
      });
    });

    it('refuses a mutating tool unless the confirmation hook allows it', async () => {
      const script = (): ScriptedLlmProvider =>
        new ScriptedLlmProvider([reply([call('c1', 'restart_service', {})]), reply([CONCLUDE])]);
      let restarts = 0;
      const stop = concludeTool();
      const tools = ToolRepository.of([mutatingTool(() => (restarts += 1)), stop]);

      const unguarded = script();
      await runner(unguarded).run(runRequest({ tools, stopTool: stop }));
      const declined = script();
      await runner(declined).run(runRequest({ tools, stopTool: stop, confirm: async () => false }));
      const allowed = script();
      await runner(allowed).run(runRequest({ tools, stopTool: stop, confirm: async () => true }));

      for (const llm of [unguarded, declined]) {
        assert.equal(
          JSON.parse(String(results(llm, 1)[0]?.content)).errorCode,
          AgentErrorCode.MutatingToolRefused,
        );
      }
      assert.equal(results(allowed, 1)[0]?.isError, undefined);
      assert.equal(restarts, 1);
    });

    it('sends a failed stop call back for correction, then completes', async () => {
      const llm = new ScriptedLlmProvider([
        reply([call('c1', 'conclude', { answer: 'retry' })]),
        reply([CONCLUDE]),
      ]);
      const result = await runner(llm).run(runRequest());

      assert.equal(result.outcome, AgentOutcome.Completed);
      assert.deepEqual(JSON.parse(String(results(llm, 1)[0]?.content)), {
        errorCode: 'TEST_CONCLUSION_INVALID',
        message: 'the answer cites nothing',
      });
    });

    it('considers only the first stop call of a reply', async () => {
      const llm = new ScriptedLlmProvider([
        reply([
          call('c1', 'conclude', { answer: 'retry' }),
          call('c2', 'conclude', { answer: 'payments' }),
        ]),
        reply([CONCLUDE]),
      ]);

      await runner(llm).run(runRequest());
      const [first, second] = results(llm, 1);

      assert.equal(first?.toolCallId, 'c1');
      assert.equal(JSON.parse(String(second?.content)).errorCode, AgentErrorCode.RepeatedStopCall);
    });
  });

  describe('endings', () => {
    it('nudges once when the model stops without a tool call, then ends inconclusive', async () => {
      const llm = new ScriptedLlmProvider([
        reply([text('I think it is payments.')], LLMFinishReason.STOP),
        reply([text('Yes, payments.')], LLMFinishReason.STOP),
      ]);
      const result = await runner(llm).run(runRequest());

      assert.equal(result.outcome, AgentOutcome.Inconclusive);
      assert.equal(
        result.outcome === AgentOutcome.Inconclusive && result.reason,
        InconclusiveReason.NoStopCall,
      );
      assert.match(lastUserText(llm, 1), /call conclude/);
    });

    it('answers calls in a cut-off reply with errors, and nudges a cut-off reply without calls', async () => {
      let ran = false;
      const echo = echoTool(1, () => {
        ran = true;
      });
      const stop = concludeTool();
      const llm = new ScriptedLlmProvider([
        reply([call('c1', 'echo', { text: 'partial' })], LLMFinishReason.LENGTH),
        reply([text('and so')], LLMFinishReason.LENGTH),
        reply([CONCLUDE]),
      ]);
      const result = await runner(llm).run(
        runRequest({ tools: ToolRepository.of([echo, stop]), stopTool: stop }),
      );

      assert.equal(result.outcome, AgentOutcome.Completed);
      assert.equal(ran, false);
      assert.equal(
        JSON.parse(String(results(llm, 1)[0]?.content)).errorCode,
        AgentErrorCode.OutputTruncated,
      );
      assert.match(lastUserText(llm, 2), /cut off/);
    });

    it('resumes a paused turn by resending it unchanged, up to a cap', async () => {
      const paused = reply([text('working')], LLMFinishReason.PAUSED);
      const resumed = new ScriptedLlmProvider([paused, reply([CONCLUDE])]);

      assert.equal((await runner(resumed).run(runRequest())).outcome, AgentOutcome.Completed);
      assert.deepEqual(resumed.requests[1]?.messages.at(-1), {
        role: LLMMessageRole.ASSISTANT,
        content: paused.content,
      });

      const stuck = new ScriptedLlmProvider(
        Array.from({ length: 6 }, () => reply([], LLMFinishReason.PAUSED)),
      );
      const result = await runner(stuck).run(runRequest());

      assert.equal(
        result.outcome === AgentOutcome.Inconclusive && result.reason,
        InconclusiveReason.PauseLimit,
      );
    });

    it('ends inconclusive when a provider filter stops the turn', async () => {
      const llm = new ScriptedLlmProvider([reply([], LLMFinishReason.CONTENT_FILTER)]);
      const result = await runner(llm).run(runRequest());

      assert.equal(
        result.outcome === AgentOutcome.Inconclusive && result.reason,
        InconclusiveReason.Refused,
      );
    });
  });

  describe('budgets', () => {
    const echoForever = (count: number): ScriptedLlmProvider =>
      new ScriptedLlmProvider(
        Array.from({ length: count }, (_, index) =>
          reply([call(`c${index}`, 'echo', { text: 'again' })]),
        ),
      );

    it('stops at the turn limit with the partial transcript, after warning on the last turn', async () => {
      const llm = echoForever(5);
      const error = await budgetError(runner(llm).run(runRequest({ budget: { maxTurns: 2 } })));

      assert.equal(error.errorCode, AgentErrorCode.BudgetExceeded);
      assert.equal(error.dimension, BudgetDimension.Turns);
      assert.equal(error.usage.turns, 2);
      assert.equal(error.transcript.messages.at(-1)?.role, LLMMessageRole.TOOL);
      assert.match(lastUserText(llm, 1), /last turn within the budget\. Call conclude now/);
    });

    it('stops before running more tool calls than allowed', async () => {
      let runs = 0;
      const echo = echoTool(1, () => (runs += 1));
      const stop = concludeTool();
      const llm = new ScriptedLlmProvider([
        reply([call('c1', 'echo', { text: 'a' }), call('c2', 'echo', { text: 'b' })]),
      ]);
      const error = await budgetError(
        runner(llm).run(
          runRequest({
            tools: ToolRepository.of([echo, stop]),
            stopTool: stop,
            budget: { maxToolCalls: 1 },
          }),
        ),
      );

      assert.equal(error.dimension, BudgetDimension.ToolCalls);
      assert.equal(runs, 0);
    });

    it('stops at the input-token, output-token and tool-cost limits', async () => {
      const cases: Array<[BudgetDimension, Parameters<typeof runRequest>[0]]> = [
        [BudgetDimension.InputTokens, { budget: { maxInputTokens: 1_500 } }],
        [BudgetDimension.OutputTokens, { budget: { maxOutputTokens: 150 } }],
        [BudgetDimension.ToolCost, { budget: { maxToolCost: 2 } }],
      ];

      for (const [dimension, overrides] of cases) {
        const error = await budgetError(runner(echoForever(5)).run(runRequest(overrides)));
        assert.equal(error.dimension, dimension);
      }
    });

    it('stops when the time budget runs out, and gives tools a signal for the time left', async () => {
      const clock = new FakeClock();
      let signal: AbortSignal | undefined;
      const echo: IAgentTool<{ readonly text: string }> = {
        ...echoTool(),
        execute: async (_, context) => {
          signal = context.signal;
          clock.time += 61_000;
          return toolOk({}, 'slow');
        },
      };
      const stop = concludeTool();
      const error = await budgetError(
        runner(echoForever(3), AGENT_CONFIG_FIXTURE, clock).run(
          runRequest({ tools: ToolRepository.of([echo, stop]), stopTool: stop }),
        ),
      );

      assert.equal(error.dimension, BudgetDimension.Time);
      assert.ok(signal instanceof AbortSignal);
    });

    it('counts error results against the tool-call budget', async () => {
      const llm = new ScriptedLlmProvider([reply([call('c1', 'nope', {})]), reply([CONCLUDE])]);
      const events: IAgentEvent[] = [];
      const result = await runner(llm).run(runRequest({ onEvent: (event) => events.push(event) }));
      const completed = events.filter((event) => event.type === AgentEventType.ToolCompleted);

      assert.equal(result.usage.toolCalls, 2);
      assert.deepEqual(
        completed.map((event) => event.type === AgentEventType.ToolCompleted && event.status),
        [ToolResultStatus.Error, ToolResultStatus.Ok],
      );
    });
  });
});
