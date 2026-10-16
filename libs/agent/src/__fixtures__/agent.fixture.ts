import { AnthropicToolPort } from '@heimdall/llm/anthropic';
import {
  LLMContentPartType,
  LLMFinishReason,
  LLMMessageRole,
  LlmProviderKind,
  type ILLMOutputContentPart,
  type ILLMProvider,
  type ILLMProviderMessageRequest,
  type ILLMProviderMessageResponse,
  type ILLMToolCallPart,
  type ILlmConfig,
} from '@heimdall/llm';
import type { IAgentClock, IAgentConfig } from '../config/agent-config.model';
import { ToolAccess } from '../enums';
import { AgentRunner } from '../runner/agent.runner';
import type { IAgentRunRequest } from '../runner/agent-run.interface';
import type { IAgentTool, IToolInputParse } from '../tools/agent-tool.interface';
import { toolError, toolOk } from '../tools/tool-results';
import { ToolRepository } from '../tools/tool.repository';

export const LLM_CONFIG_FIXTURE: ILlmConfig = {
  preferredProvider: LlmProviderKind.ANTHROPIC,
  anthropic: { apiKey: undefined, apiUrl: 'https://api.example', apiVersion: '2023-06-01' },
};

export const AGENT_CONFIG_FIXTURE: IAgentConfig = {
  budget: {
    maxTurns: 8,
    maxToolCalls: 20,
    maxInputTokens: 100_000,
    maxOutputTokens: 10_000,
    maxToolCost: 50,
    timeoutMs: 60_000,
  },
  toolConcurrency: 2,
};

export class FakeClock implements IAgentClock {
  constructor(public time = 0) {}

  now(): number {
    return this.time;
  }
}

type Reply = ILLMProviderMessageResponse | (() => Promise<ILLMProviderMessageResponse>);

/** Replays canned replies in order and records a deep copy of every request it receives. */
export class ScriptedLlmProvider implements ILLMProvider {
  readonly requests: ILLMProviderMessageRequest[] = [];

  constructor(private readonly replies: Reply[]) {}

  async chat(request: ILLMProviderMessageRequest): Promise<ILLMProviderMessageResponse> {
    this.requests.push(structuredClone(request));
    const reply = this.replies.shift();

    if (reply === undefined) {
      throw new Error(`the script has no reply for request ${this.requests.length}`);
    }
    return typeof reply === 'function' ? reply() : reply;
  }
}

export function call(id: string, name: string, input: Record<string, unknown>): ILLMToolCallPart {
  return { type: LLMContentPartType.TOOL_CALL, id, name, input };
}

export function text(value: string): ILLMOutputContentPart {
  return { type: LLMContentPartType.TEXT, text: value };
}

export function reply(
  content: ILLMOutputContentPart[],
  finishReason: LLMFinishReason = LLMFinishReason.TOOL_CALLS,
  usage = { inputTokens: 1_000, outputTokens: 100 },
): ILLMProviderMessageResponse {
  return {
    id: `msg_${Math.random().toString(16).slice(2)}`,
    model: 'claude-opus-5',
    role: LLMMessageRole.ASSISTANT,
    content,
    finishReason,
    usage,
  };
}

function parseObject<T>(
  input: unknown,
  check: (value: Record<string, unknown>) => T | string,
): IToolInputParse<T> {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, problem: 'input must be an object' };
  }
  const checked = check(input as Record<string, unknown>);
  return typeof checked === 'string'
    ? { ok: false, problem: checked }
    : { ok: true, input: checked };
}

export interface IEchoInput {
  readonly text: string;
}

/** Echoes `text`; `cost` lets a spec spend the tool-cost budget. */
export function echoTool(cost = 1, onExecute?: () => void): IAgentTool<IEchoInput> {
  return {
    name: 'echo',
    description: 'Echoes its text',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', minLength: 1 } },
      required: ['text'],
    },
    access: ToolAccess.ReadOnly,
    parse: (input) =>
      parseObject(input, ({ text: value }) =>
        typeof value === 'string' && value.length > 0
          ? { text: value }
          : 'text must be a non-empty string',
      ),
    execute: async ({ text: value }) => {
      onExecute?.();
      return toolOk({ echoed: value }, `echoed ${value.length} characters`, cost);
    },
  };
}

export interface IConclusion {
  readonly answer: string;
}

/** The stop tool: rejects the answer `retry`, so a spec can see a correction round. */
export function concludeTool(): IAgentTool<IConclusion> {
  return {
    name: 'conclude',
    description: 'Ends the run with an answer',
    inputSchema: {
      type: 'object',
      properties: { answer: { type: 'string' } },
      required: ['answer'],
    },
    access: ToolAccess.ReadOnly,
    parse: (input) =>
      parseObject(input, ({ answer }) =>
        typeof answer === 'string' ? { answer } : 'answer must be a string',
      ),
    execute: async ({ answer }) =>
      answer === 'retry'
        ? toolError('TEST_CONCLUSION_INVALID', 'the answer cites nothing')
        : toolOk({ accepted: true }, 'accepted'),
  };
}

export function throwingTool(): IAgentTool<Record<string, never>> {
  return {
    name: 'explode',
    description: 'Always fails',
    inputSchema: { type: 'object', properties: {} },
    access: ToolAccess.ReadOnly,
    parse: () => ({ ok: true, input: {} }),
    execute: async () => {
      throw new Error('backend unreachable');
    },
  };
}

export function mutatingTool(onExecute: () => void): IAgentTool<Record<string, never>> {
  return {
    name: 'restart_service',
    description: 'Restarts a service',
    inputSchema: { type: 'object', properties: {} },
    access: ToolAccess.Mutating,
    parse: () => ({ ok: true, input: {} }),
    execute: async () => {
      onExecute();
      return toolOk({ restarted: true }, 'restarted');
    },
  };
}

export function runner(
  llm: ILLMProvider,
  config: IAgentConfig = AGENT_CONFIG_FIXTURE,
  clock: IAgentClock = new FakeClock(),
): AgentRunner {
  return new AgentRunner(llm, new AnthropicToolPort(), LLM_CONFIG_FIXTURE, config, clock);
}

export function runRequest(
  overrides: Partial<IAgentRunRequest<IConclusion>> = {},
): IAgentRunRequest<IConclusion> {
  const stopTool = overrides.stopTool ?? concludeTool();

  return {
    agent: 'test.agent',
    model: 'claude-opus-5',
    system: 'You test.',
    messages: [{ role: LLMMessageRole.USER, content: 'Begin.' }],
    tools: ToolRepository.of([echoTool(), stopTool]),
    stopTool,
    ...overrides,
  };
}
