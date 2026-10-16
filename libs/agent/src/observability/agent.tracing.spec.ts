import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { metrics, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { MeterProvider, MetricReader, type ResourceMetrics } from '@opentelemetry/sdk-metrics';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import { LLMContentPartType, LLMMessageRole } from '@heimdall/llm';
import {
  ScriptedLlmProvider,
  call,
  concludeTool,
  echoTool,
  reply,
  runRequest,
  runner,
  type IEchoInput,
} from '../__fixtures__/agent.fixture';
import { AgentErrorCode } from '../errors';
import type { IAgentTool } from '../tools/agent-tool.interface';
import { toolOk } from '../tools/tool-results';
import { ToolRepository } from '../tools/tool.repository';
import { AgentMetric, GenAiAttribute, HeimdallAttribute } from './agent-telemetry.enums';

/** Collects on demand, so a spec reads metrics without waiting for an export interval. */
class CollectingReader extends MetricReader {
  protected override async onForceFlush(): Promise<void> {}
  protected override async onShutdown(): Promise<void> {}
}

const MARKERS = {
  system: 'SYSTEM-MARKER-7f3a',
  seed: 'SEED-MARKER-91bc',
  input: 'INPUT-MARKER-c0de',
  output: 'OUTPUT-MARKER-55aa',
  reasoning: 'REASONING-MARKER-e1e1',
  conclusion: 'CONCLUSION-MARKER-0b0b',
};

const exporter = new InMemorySpanExporter();
const reader = new CollectingReader();
const tracerProvider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});
const meterProvider = new MeterProvider({ readers: [reader] });

function byName(spans: readonly ReadableSpan[], prefix: string): ReadableSpan[] {
  return spans.filter((span) => span.name.startsWith(prefix));
}

/** Everything an exporter could send, as text: names, attributes, events, statuses, data points. */
function exported(spans: readonly ReadableSpan[], resourceMetrics: ResourceMetrics): string {
  return JSON.stringify({
    spans: spans.map(({ name, attributes, events, status, links }) => ({
      name,
      attributes,
      events,
      status,
      links,
    })),
    metrics: resourceMetrics.scopeMetrics.flatMap(({ metrics: list }) =>
      list.map(({ descriptor, dataPoints }) => ({ name: descriptor.name, dataPoints })),
    ),
  });
}

describe('AgentRunner tracing and metrics', () => {
  let spans: ReadableSpan[] = [];
  let resourceMetrics: ResourceMetrics;
  let traceId: string | undefined;

  before(async () => {
    trace.setGlobalTracerProvider(tracerProvider);
    metrics.setGlobalMeterProvider(meterProvider);

    const echo: IAgentTool<IEchoInput> = {
      ...echoTool(),
      execute: async () => toolOk({ echoed: MARKERS.output }, 'echoed', 3),
    };
    const stop = concludeTool();
    const llm = new ScriptedLlmProvider([
      reply(
        [
          { type: LLMContentPartType.REASONING, text: MARKERS.reasoning, signature: 'sig' },
          call('call-1', 'echo', { text: MARKERS.input }),
          call('call-2', 'nope', {}),
        ],
        undefined,
        { inputTokens: 1_200, outputTokens: 80 },
      ),
      reply([call('call-3', 'conclude', { answer: MARKERS.conclusion })], undefined, {
        inputTokens: 1_500,
        outputTokens: 40,
      }),
    ]);
    const result = await runner(llm).run(
      runRequest({
        agent: 'heimdall.test',
        system: MARKERS.system,
        messages: [{ role: LLMMessageRole.USER, content: MARKERS.seed }],
        tools: ToolRepository.of([echo, stop]),
        stopTool: stop,
      }),
    );

    traceId = result.traceId;
    spans = exporter.getFinishedSpans();
    ({ resourceMetrics } = await reader.collect());
  });

  after(async () => {
    await Promise.all([tracerProvider.shutdown(), meterProvider.shutdown()]);
  });

  it('records one invoke_agent span with chat and execute_tool children, and returns its trace id', () => {
    const [root] = byName(spans, 'invoke_agent');
    const children = spans.filter((span) => span !== root);

    assert.equal(root?.name, 'invoke_agent heimdall.test');
    assert.equal(root?.kind, SpanKind.INTERNAL);
    assert.equal(traceId, root?.spanContext().traceId);
    assert.deepEqual(children.map((span) => span.name).sort(), [
      'chat claude-opus-5',
      'chat claude-opus-5',
      'execute_tool conclude',
      'execute_tool echo',
      'execute_tool nope',
    ]);
    for (const child of children) {
      assert.equal(child.parentSpanContext?.spanId, root?.spanContext().spanId, child.name);
      assert.equal(child.spanContext().traceId, root?.spanContext().traceId);
    }
  });

  it('describes the run on its root span', () => {
    const [root] = byName(spans, 'invoke_agent');

    assert.deepEqual(
      {
        operation: root?.attributes[GenAiAttribute.OperationName],
        agent: root?.attributes[GenAiAttribute.AgentName],
        provider: root?.attributes[GenAiAttribute.ProviderName],
        outcome: root?.attributes[HeimdallAttribute.AgentOutcome],
        turns: root?.attributes[HeimdallAttribute.AgentTurns],
        toolCalls: root?.attributes[HeimdallAttribute.AgentToolCalls],
        inputTokens: root?.attributes[GenAiAttribute.UsageInputTokens],
      },
      {
        operation: 'invoke_agent',
        agent: 'heimdall.test',
        provider: 'anthropic',
        outcome: 'completed',
        turns: 2,
        toolCalls: 3,
        inputTokens: 2_700,
      },
    );
  });

  it('records model calls as client spans with GenAI usage attributes', () => {
    const [first] = byName(spans, 'chat');

    assert.equal(first?.kind, SpanKind.CLIENT);
    assert.equal(first?.attributes[GenAiAttribute.RequestModel], 'claude-opus-5');
    assert.equal(first?.attributes[GenAiAttribute.UsageInputTokens], 1_200);
    assert.equal(first?.attributes[GenAiAttribute.UsageOutputTokens], 80);
    assert.deepEqual(first?.attributes[GenAiAttribute.ResponseFinishReasons], ['tool_calls']);
    assert.equal(first?.attributes[GenAiAttribute.RequestMaxTokens], 16_000);
  });

  it('records tool calls with their status and cost, and marks error results by code alone', () => {
    const [echo] = byName(spans, 'execute_tool echo');
    const [unknown] = byName(spans, 'execute_tool nope');

    assert.equal(echo?.attributes[GenAiAttribute.ToolCallId], 'call-1');
    assert.equal(echo?.attributes[HeimdallAttribute.ToolStatus], 'ok');
    assert.equal(echo?.attributes[HeimdallAttribute.ToolCost], 3);
    assert.equal(echo?.status.code, SpanStatusCode.UNSET);
    assert.equal(unknown?.attributes[GenAiAttribute.ErrorType], AgentErrorCode.UnknownTool);
    assert.deepEqual(unknown?.status, {
      code: SpanStatusCode.ERROR,
      message: AgentErrorCode.UnknownTool,
    });
  });

  it('records token usage, tool calls and budget use as metrics', () => {
    const points = (name: AgentMetric) =>
      resourceMetrics.scopeMetrics
        .flatMap(({ metrics: list }) => list)
        .find(({ descriptor }) => descriptor.name === name)?.dataPoints ?? [];
    const sum = (name: AgentMetric, type: string): number =>
      points(name)
        .filter((point) => point.attributes[GenAiAttribute.TokenType] === type)
        .reduce((total, point) => total + ((point.value as { sum: number }).sum ?? 0), 0);

    assert.equal(sum(AgentMetric.TokenUsage, 'input'), 2_700);
    assert.equal(sum(AgentMetric.TokenUsage, 'output'), 120);
    assert.deepEqual(
      points(AgentMetric.ToolCalls)
        .map((point) => [
          point.attributes[GenAiAttribute.ToolName],
          point.attributes[HeimdallAttribute.ToolStatus],
          point.value,
        ])
        .sort(),
      [
        ['conclude', 'ok', 1],
        ['echo', 'ok', 1],
        ['nope', 'error', 1],
      ],
    );
    assert.equal(points(AgentMetric.BudgetUsed).length, 6);
    assert.equal(points(AgentMetric.OperationDuration).length > 0, true);
  });

  it('exports no prompt, message, reasoning, tool input, tool output or conclusion text', () => {
    const text = exported(spans, resourceMetrics);

    for (const [where, marker] of Object.entries(MARKERS)) {
      assert.equal(text.includes(marker), false, `${where} text leaked into the export`);
    }
  });
});
