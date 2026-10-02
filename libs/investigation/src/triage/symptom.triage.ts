import { Inject, Injectable } from '@nestjs/common';
import { IndicatorRole } from '@heimdall/core/manifest';
import { renderLevelZero, vertexKey, VertexType, type SystemGraph } from '@heimdall/core/graph';
import {
  InjectLlmProvider,
  LLMContentPartType,
  LLMMessageRole,
  LLMReasoningEffort,
  LLMToolChoiceType,
  type ILLMProvider,
  type ILLMProviderMessageRequest,
  type ILLMProviderMessageResponse,
} from '@heimdall/llm';
import type { IInvestigationConfig } from '../config/investigation-config.model';
import { InvestigationError, InvestigationErrorCode } from '../errors';
import type { IEntryCandidate } from '../interfaces';
import { INVESTIGATION_CONFIG } from '../investigation.tokens';
import {
  SELECT_ENTRY_TOOL,
  selectEntryTool,
  TRIAGE_SYSTEM_PROMPT,
  triageMessage,
} from './triage.prompt';

export interface ITriageResult {
  /** Empty when the model named none. */
  readonly roles: readonly IndicatorRole[];
  /** Best first; empty when nothing fits. */
  readonly candidates: readonly IEntryCandidate[];
}

/** What a free-text report can land on (ADR 0016). */
export const LOCATABLE_TYPES: ReadonlySet<VertexType> = new Set([
  VertexType.Functionality,
  VertexType.Flow,
  VertexType.Component,
  VertexType.Member,
]);

const ATTEMPTS = 2;
/** Room for adaptive thinking before a short tool call. */
const MAX_TOKENS = 4096;
const ROLES: ReadonlySet<string> = new Set(Object.values(IndicatorRole));
const MIN_HINT_LENGTH = 3;

/**
 * The only model call of the init phase: which vertex a report is about, and which signal
 * kinds would show it. Only the query and the level-0 index are sent, never telemetry.
 */
@Injectable()
export class SymptomTriage {
  constructor(
    @InjectLlmProvider() private readonly llm: ILLMProvider,
    @Inject(INVESTIGATION_CONFIG) private readonly config: IInvestigationConfig,
  ) {}

  async classify(query: string, graph: SystemGraph, environment?: string): Promise<ITriageResult> {
    const locatable = graph.vertices
      .filter((vertex) => LOCATABLE_TYPES.has(vertex.type))
      .map((vertex) => vertex.id);

    if (locatable.length === 0) {
      throw new InvestigationError(
        InvestigationErrorCode.EntryNotFound,
        `system ${graph.system.name} has no functionalities, flows or components to investigate`,
      );
    }
    const request = this.request(query, renderLevelZero(graph, environment), locatable);
    const known = new Set(locatable);

    for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
      const result = this.parse(await this.llm.chat(request), known);

      if (result !== undefined) {
        return result;
      }
    }
    throw new InvestigationError(
      InvestigationErrorCode.TriageFailed,
      `the model did not answer through ${SELECT_ENTRY_TOOL} with ids from the index after ${ATTEMPTS} attempts`,
    );
  }

  private request(
    query: string,
    index: string,
    locatable: readonly string[],
  ): ILLMProviderMessageRequest {
    return {
      model: this.config.triage.model,
      system: TRIAGE_SYSTEM_PROMPT,
      messages: [
        {
          role: LLMMessageRole.USER,
          content: triageMessage(index, query, this.exactMatches(query, locatable)),
        },
      ],
      tools: [selectEntryTool(locatable)],
      toolChoice: { type: LLMToolChoiceType.AUTO },
      reasoning: { effort: LLMReasoningEffort.LOW },
      maxTokens: MAX_TOKENS,
    };
  }

  /** `undefined` means invalid: no tool call, or ids and values the graph does not know. */
  private parse(
    response: ILLMProviderMessageResponse,
    known: ReadonlySet<string>,
  ): ITriageResult | undefined {
    const call = response.content.find(
      (part) => part.type === LLMContentPartType.TOOL_CALL && part.name === SELECT_ENTRY_TOOL,
    );

    if (call?.type !== LLMContentPartType.TOOL_CALL) {
      return undefined;
    }
    const { candidates, symptomRoles } = call.input;

    if (!Array.isArray(candidates) || !Array.isArray(symptomRoles)) {
      return undefined;
    }
    const parsed = candidates.map((candidate: unknown) => this.candidate(candidate, known));

    if (
      parsed.some((candidate) => candidate === undefined) ||
      !symptomRoles.every((role: unknown) => typeof role === 'string' && ROLES.has(role))
    ) {
      return undefined;
    }
    const best = new Map<string, IEntryCandidate>();

    for (const candidate of parsed as IEntryCandidate[]) {
      if ((best.get(candidate.vertex)?.confidence ?? -1) < candidate.confidence) {
        best.set(candidate.vertex, candidate);
      }
    }
    return {
      roles: [...new Set(symptomRoles as IndicatorRole[])],
      candidates: [...best.values()]
        .sort((left, right) => right.confidence - left.confidence)
        .slice(0, this.config.triage.maxCandidates),
    };
  }

  private candidate(value: unknown, known: ReadonlySet<string>): IEntryCandidate | undefined {
    if (typeof value !== 'object' || value === null) {
      return undefined;
    }
    const { vertexId, confidence, reason } = value as Record<string, unknown>;

    if (
      typeof vertexId !== 'string' ||
      !known.has(vertexId) ||
      typeof confidence !== 'number' ||
      !(confidence >= 0 && confidence <= 1) ||
      typeof reason !== 'string'
    ) {
      return undefined;
    }
    return { vertex: vertexId, confidence, reason };
  }

  /** Vertex names written verbatim in the report, e.g. `mysql-main`: hints, not answers. */
  private exactMatches(query: string, locatable: readonly string[]): string[] {
    const words = new Set(query.toLowerCase().split(/[^a-z0-9/-]+/));

    return locatable.filter((id) => {
      const key = vertexKey(id);
      return key.length >= MIN_HINT_LENGTH && words.has(key);
    });
  }
}
