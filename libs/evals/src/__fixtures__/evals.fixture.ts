import 'reflect-metadata';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  LLM_PROVIDER,
  LLMContentPartType,
  LLMFinishReason,
  LLMMessageRole,
  type ILLMOutputContentPart,
  type ILLMProvider,
  type ILLMProviderMessageRequest,
  type ILLMProviderMessageResponse,
} from '@heimdall/llm';
import type { IEvalsConfig } from '../config/evals-config.model';
import { EvalsModule } from '../evals.module';
import { EVALS_CONFIG } from '../evals.tokens';

/** A judge model that answers each call with the next scripted reply, then repeats the last. */
export class ScriptedJudge implements ILLMProvider {
  readonly requests: ILLMProviderMessageRequest[] = [];

  constructor(private readonly replies: readonly (readonly ILLMOutputContentPart[])[]) {}

  async chat(request: ILLMProviderMessageRequest): Promise<ILLMProviderMessageResponse> {
    this.requests.push(request);
    const content = this.replies[this.requests.length - 1] ?? this.replies.at(-1) ?? [];

    return {
      id: `msg_${this.requests.length}`,
      model: request.model,
      role: LLMMessageRole.ASSISTANT,
      content: [...content],
      finishReason: LLMFinishReason.TOOL_CALLS,
      usage: { inputTokens: 1_000, outputTokens: 50 },
    };
  }
}

export function scoreCall(
  component: number,
  mechanism: number,
  evidence: number,
  id = 'call-1',
): ILLMOutputContentPart[] {
  return [
    {
      type: LLMContentPartType.TOOL_CALL,
      id,
      name: 'score',
      input: {
        component: { score: component, reason: 'component reason' },
        mechanism: { score: mechanism, reason: 'mechanism reason' },
        evidence: { score: evidence, reason: 'evidence reason' },
      },
    },
  ];
}

export async function evalsModule(
  judge: ILLMProvider,
  config: IEvalsConfig,
): Promise<TestingModule> {
  return Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), EvalsModule],
  })
    .overrideProvider(LLM_PROVIDER)
    .useValue(judge)
    .overrideProvider(EVALS_CONFIG)
    .useValue(config)
    .compile();
}
