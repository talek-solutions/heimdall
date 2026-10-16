import {
  context,
  metrics,
  SpanKind,
  SpanStatusCode,
  trace,
  type Attributes,
  type Context,
  type Counter,
  type Histogram,
  type Span,
} from '@opentelemetry/api';
import { isHeimdallError } from '@heimdall/core';
import type { ILLMProviderMessageResponse } from '@heimdall/llm';
import {
  ToolResultStatus,
  type AgentOutcome,
  type BudgetDimension,
  type InconclusiveReason,
} from '../enums';
import type { IAgentUsage } from '../runner/agent-run.interface';
import type { IToolResult } from '../tools/agent-tool.interface';
import {
  AgentMetric,
  GenAiAttribute,
  GenAiOperation,
  GenAiTokenType,
  GenAiToolType,
  HeimdallAttribute,
} from './agent-telemetry.enums';

const INSTRUMENTATION_SCOPE = '@heimdall/agent';

/**
 * Spans and metrics for one run. Records ids, names, counts, durations and statuses only: no
 * prompt, message, reasoning, tool input or output ever becomes an attribute (ADR 0017). With no
 * SDK registered, every call is a no-op.
 */
export class AgentRunTelemetry {
  private readonly tracer = trace.getTracer(INSTRUMENTATION_SCOPE);
  private readonly tokenUsage: Histogram;
  private readonly operationDuration: Histogram;
  private readonly toolCalls: Counter;
  private readonly budgetUsed: Histogram;
  private readonly root: Span;
  private readonly runContext: Context;
  /** Undefined when nothing records the run, so callers never link to an empty trace. */
  readonly traceId: string | undefined;

  constructor(
    private readonly agent: string,
    private readonly model: string,
    private readonly provider: string,
  ) {
    // Instruments are taken per run: the metrics API has no proxy, so a provider registered
    // after this module loaded is still used.
    const meter = metrics.getMeter(INSTRUMENTATION_SCOPE);

    this.tokenUsage = meter.createHistogram(AgentMetric.TokenUsage, { unit: '{token}' });
    this.operationDuration = meter.createHistogram(AgentMetric.OperationDuration, { unit: 's' });
    this.toolCalls = meter.createCounter(AgentMetric.ToolCalls, { unit: '{call}' });
    this.budgetUsed = meter.createHistogram(AgentMetric.BudgetUsed, { unit: '1' });
    this.root = this.tracer.startSpan(`${GenAiOperation.InvokeAgent} ${agent}`, {
      kind: SpanKind.INTERNAL,
      attributes: {
        [GenAiAttribute.OperationName]: GenAiOperation.InvokeAgent,
        [GenAiAttribute.AgentName]: agent,
        [GenAiAttribute.ProviderName]: provider,
        [GenAiAttribute.RequestModel]: model,
      },
    });
    this.runContext = trace.setSpan(context.active(), this.root);
    // Read now: an ended span no longer reports that it is recording.
    this.traceId = this.root.isRecording() ? this.root.spanContext().traceId : undefined;
  }

  async chat(
    maxTokens: number,
    call: () => Promise<ILLMProviderMessageResponse>,
  ): Promise<ILLMProviderMessageResponse> {
    const shared: Attributes = {
      [GenAiAttribute.OperationName]: GenAiOperation.Chat,
      [GenAiAttribute.ProviderName]: this.provider,
      [GenAiAttribute.RequestModel]: this.model,
    };
    const span = this.tracer.startSpan(
      `${GenAiOperation.Chat} ${this.model}`,
      {
        kind: SpanKind.CLIENT,
        attributes: { ...shared, [GenAiAttribute.RequestMaxTokens]: maxTokens },
      },
      this.runContext,
    );
    const startedAt = performance.now();

    try {
      const response = await call();
      const measured = { ...shared, [GenAiAttribute.ResponseModel]: response.model };

      span.setAttributes({
        [GenAiAttribute.ResponseId]: response.id,
        [GenAiAttribute.ResponseModel]: response.model,
        [GenAiAttribute.ResponseFinishReasons]: [response.finishReason],
        [GenAiAttribute.UsageInputTokens]: response.usage.inputTokens,
        [GenAiAttribute.UsageOutputTokens]: response.usage.outputTokens,
        [HeimdallAttribute.CachedInputTokens]: response.usage.cachedInputTokens ?? 0,
      });
      this.tokenUsage.record(response.usage.inputTokens, {
        ...measured,
        [GenAiAttribute.TokenType]: GenAiTokenType.Input,
      });
      this.tokenUsage.record(response.usage.outputTokens, {
        ...measured,
        [GenAiAttribute.TokenType]: GenAiTokenType.Output,
      });
      this.operationDuration.record(seconds(startedAt), measured);
      return response;
    } catch (error) {
      this.markFailed(span, errorType(error));
      this.operationDuration.record(seconds(startedAt), {
        ...shared,
        [GenAiAttribute.ErrorType]: errorType(error),
      });
      throw error;
    } finally {
      span.end();
    }
  }

  /** Runs `execute` inside the tool's span, so spans the tool opens nest under it. */
  async tool(
    name: string,
    callId: string,
    execute: () => Promise<IToolResult>,
  ): Promise<IToolResult> {
    const span = this.tracer.startSpan(
      `${GenAiOperation.ExecuteTool} ${name}`,
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          [GenAiAttribute.OperationName]: GenAiOperation.ExecuteTool,
          [GenAiAttribute.ToolName]: name,
          [GenAiAttribute.ToolCallId]: callId,
          [GenAiAttribute.ToolType]: GenAiToolType.Function,
        },
      },
      this.runContext,
    );

    try {
      const result = await context.with(trace.setSpan(this.runContext, span), execute);

      span.setAttributes({
        [HeimdallAttribute.ToolStatus]: result.status,
        [HeimdallAttribute.ToolCost]: result.cost ?? 0,
      });
      if (result.status === ToolResultStatus.Error) {
        this.markFailed(span, resultErrorCode(result));
      }
      this.toolCalls.add(1, {
        [GenAiAttribute.ToolName]: name,
        [HeimdallAttribute.ToolStatus]: result.status,
      });
      return result;
    } finally {
      span.end();
    }
  }

  finish(
    outcome: AgentOutcome,
    reason: InconclusiveReason | undefined,
    usage: IAgentUsage,
    fractions: ReadonlyMap<BudgetDimension, number>,
  ): void {
    this.root.setAttributes({
      [HeimdallAttribute.AgentOutcome]: outcome,
      ...(reason === undefined ? {} : { [HeimdallAttribute.AgentInconclusiveReason]: reason }),
    });
    this.end(usage, fractions);
  }

  fail(error: unknown, usage: IAgentUsage, fractions: ReadonlyMap<BudgetDimension, number>): void {
    this.markFailed(this.root, errorType(error));
    this.end(usage, fractions);
  }

  private end(usage: IAgentUsage, fractions: ReadonlyMap<BudgetDimension, number>): void {
    this.root.setAttributes({
      [HeimdallAttribute.AgentTurns]: usage.turns,
      [HeimdallAttribute.AgentToolCalls]: usage.toolCalls,
      [GenAiAttribute.UsageInputTokens]: usage.inputTokens,
      [GenAiAttribute.UsageOutputTokens]: usage.outputTokens,
    });
    for (const [dimension, fraction] of fractions) {
      this.budgetUsed.record(fraction, {
        [GenAiAttribute.AgentName]: this.agent,
        [HeimdallAttribute.BudgetDimension]: dimension,
      });
    }
    this.root.end();
  }

  /** The status message is the error's code alone: messages can quote content. */
  private markFailed(span: Span, type: string): void {
    span.setAttribute(GenAiAttribute.ErrorType, type);
    span.setStatus({ code: SpanStatusCode.ERROR, message: type });
  }
}

function seconds(startedAt: number): number {
  return (performance.now() - startedAt) / 1_000;
}

function errorType(error: unknown): string {
  if (isHeimdallError(error)) {
    return error.errorCode;
  }
  return error instanceof Error ? error.name : 'unknown';
}

function resultErrorCode(result: IToolResult): string {
  const { content } = result;

  if (typeof content === 'object' && content !== null && 'errorCode' in content) {
    const { errorCode } = content;
    return typeof errorCode === 'string' ? errorCode : 'unknown';
  }
  return 'unknown';
}
