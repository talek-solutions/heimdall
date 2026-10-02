import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { SystemGraphCompiler, type SystemGraph } from '@heimdall/core/graph';
import { ManifestReader, ManifestV1Parser, type IManifestV1 } from '@heimdall/core/manifest';
import {
  LLMContentPartType,
  LLMFinishReason,
  LLMMessageRole,
  type ILLMOutputContentPart,
  type ILLMProvider,
  type ILLMProviderMessageRequest,
  type ILLMProviderMessageResponse,
} from '@heimdall/llm';
import type { IClock, IInvestigationConfig } from '../config/investigation-config.model';
import { SELECT_ENTRY_TOOL } from '../triage/triage.prompt';

export enum ReferenceManifest {
  Shop = 'shop',
  Checkout = 'checkout',
}

export const NOW = new Date('2026-09-27T12:00:00.000Z');

export const FIXED_CLOCK: IClock = { now: () => new Date(NOW.getTime()) };

export function testConfig(overrides: Partial<IInvestigationConfig> = {}): IInvestigationConfig {
  return {
    lookbackMs: 60 * 60_000,
    hopBudget: 1,
    maxChecks: 200,
    triage: { model: 'test-model', minConfidence: 0.5, ambiguityMargin: 0.15, maxCandidates: 3 },
    ...overrides,
  };
}

/** Specs run from `dist`, so walk up to the repository. */
export function referenceManifestPath(name: ReferenceManifest): string {
  const relative = join('.docs', 'manifests', name, 'manifest.yaml');
  let directory = __dirname;

  while (!existsSync(join(directory, relative))) {
    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error(`${relative} not found above ${__dirname}`);
    }
    directory = parent;
  }
  return join(directory, relative);
}

export async function loadManifest(name: ReferenceManifest): Promise<IManifestV1> {
  return new ManifestReader(new ManifestV1Parser()).parse(
    readFileSync(referenceManifestPath(name), 'utf8'),
  );
}

export async function loadGraph(name: ReferenceManifest): Promise<SystemGraph> {
  return new SystemGraphCompiler().compile(await loadManifest(name));
}

export interface ISelectEntryInput {
  readonly candidates: readonly { vertexId: string; confidence: number; reason: string }[];
  readonly symptomRoles: readonly string[];
}

export function selectEntryCall(input: ISelectEntryInput): ILLMOutputContentPart[] {
  return [
    {
      type: LLMContentPartType.TOOL_CALL,
      id: 'toolu_1',
      name: SELECT_ENTRY_TOOL,
      input: input as unknown as Record<string, unknown>,
    },
  ];
}

export function textOnly(text: string): ILLMOutputContentPart[] {
  return [{ type: LLMContentPartType.TEXT, text }];
}

/** Answers with queued contents in order and records every request. */
export class FakeLlmProvider implements ILLMProvider {
  readonly requests: ILLMProviderMessageRequest[] = [];

  constructor(private readonly replies: ILLMOutputContentPart[][]) {}

  async chat(request: ILLMProviderMessageRequest): Promise<ILLMProviderMessageResponse> {
    this.requests.push(request);
    const content = this.replies.shift();

    if (content === undefined) {
      throw new Error('FakeLlmProvider: no reply queued');
    }
    return {
      id: `msg_${this.requests.length}`,
      model: request.model,
      role: LLMMessageRole.ASSISTANT,
      content,
      finishReason: LLMFinishReason.TOOL_CALLS,
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }
}
