import { Inject, Injectable } from '@nestjs/common';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import {
  SystemGraphCompiler,
  VertexType,
  type IGraphVertex,
  type SystemGraph,
} from '@heimdall/core/graph';
import { IndicatorRole, type IManifestV1 } from '@heimdall/core/manifest';
import type { IInvestigationConfig } from './config/investigation-config.model';
import { EntryMethod, InvestigationEventType, SymptomMethod } from './enums';
import { AmbiguousEntryError, InvestigationError, InvestigationErrorCode } from './errors';
import type {
  IEntryCandidate,
  IInvestigationEntry,
  IInvestigationEvent,
  IInvestigationPlan,
  IInvestigationRequest,
  IPrepareOptions,
  ISymptom,
} from './interfaces';
import { InvestigationIntake } from './intake/investigation.intake';
import { CheckPlanner } from './plan/check.planner';
import { ScopeResolver } from './scope/scope.resolver';
import { INVESTIGATION_CONFIG } from './investigation.tokens';
import { LOCATABLE_TYPES, SymptomTriage, type ITriageResult } from './triage/symptom.triage';

const ALL_ROLES: readonly IndicatorRole[] = Object.values(IndicatorRole);
/** 0.6 - 0.45 is 0.1499… in floating point; a gap of exactly the margin is not close. */
const CONFIDENCE_TOLERANCE = 1e-9;
const tracer = trace.getTracer('@heimdall/investigation');

enum InitSpanAttribute {
  System = 'heimdall.investigation.system',
  EntryMethod = 'heimdall.investigation.entry_method',
  Checks = 'heimdall.investigation.checks',
}

/** Named entries may also be a step or a dependency, which free text never lands on. */
const NAMEABLE_TYPES: ReadonlySet<VertexType> = new Set([
  ...LOCATABLE_TYPES,
  VertexType.Step,
  VertexType.Dependency,
]);

/**
 * The init phase of an investigation (ADR 0016): from an engineer's words to an ordered
 * plan of checks. Only classification may call a model; everything else is a graph walk.
 */
@Injectable()
export class InvestigationInitService {
  constructor(
    private readonly compiler: SystemGraphCompiler,
    private readonly intake: InvestigationIntake,
    private readonly triage: SymptomTriage,
    private readonly scopes: ScopeResolver,
    private readonly planner: CheckPlanner,
    @Inject(INVESTIGATION_CONFIG) private readonly config: IInvestigationConfig,
  ) {}

  /** Spanned as `investigation.init`; ids and counts only, never the engineer's words. */
  async prepare(
    manifest: IManifestV1,
    request: IInvestigationRequest,
    options: IPrepareOptions = {},
  ): Promise<IInvestigationPlan> {
    return tracer.startActiveSpan('investigation.init', async (span) => {
      try {
        const plan = await this.plan(manifest, request, options);

        span.setAttributes({
          [InitSpanAttribute.System]: plan.system,
          [InitSpanAttribute.EntryMethod]: plan.entry.method,
          [InitSpanAttribute.Checks]: plan.checks.length,
        });
        return plan;
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        span.end();
      }
    });
  }

  private async plan(
    manifest: IManifestV1,
    request: IInvestigationRequest,
    options: IPrepareOptions,
  ): Promise<IInvestigationPlan> {
    const emit = (event: IInvestigationEvent): void => options.onEvent?.(event);
    const graph = this.compiler.compile(manifest);
    const { query, environment, window } = this.intake.resolve(graph, request);

    emit({
      type: InvestigationEventType.Started,
      query,
      system: graph.system.name,
      environment,
      window,
    });

    const { symptom, entry } =
      request.entry === undefined
        ? await this.classify(graph, query, environment?.name, options)
        : this.named(graph, request.entry);

    emit({ type: InvestigationEventType.SymptomClassified, symptom });
    emit({ type: InvestigationEventType.EntryLocated, entry });

    const scope = this.scopes.resolve(graph, entry.vertex, symptom.roles);
    emit({ type: InvestigationEventType.ScopeResolved, scope });

    const { checks, blindSpots, omittedChecks } = this.planner.plan(
      graph,
      entry.vertex,
      scope,
      symptom.roles,
    );
    const plan: IInvestigationPlan = {
      query,
      system: graph.system.name,
      environment,
      window,
      symptom,
      entry,
      scope,
      checks,
      blindSpots,
      omittedChecks,
    };

    emit({ type: InvestigationEventType.PlanReady, plan });
    return plan;
  }

  private async classify(
    graph: SystemGraph,
    query: string,
    environment: string | undefined,
    options: IPrepareOptions,
  ): Promise<{ readonly symptom: ISymptom; readonly entry: IInvestigationEntry }> {
    const result = await this.triage.classify(query, graph, environment);
    const symptom: ISymptom = {
      roles: result.roles.length === 0 ? ALL_ROLES : result.roles,
      method: SymptomMethod.Model,
    };

    return { symptom, entry: await this.choose(graph, result, symptom.roles, options) };
  }

  private async choose(
    graph: SystemGraph,
    { candidates }: ITriageResult,
    roles: readonly IndicatorRole[],
    options: IPrepareOptions,
  ): Promise<IInvestigationEntry> {
    const [top, ...others] = candidates;

    if (top === undefined) {
      throw new InvestigationError(
        InvestigationErrorCode.EntryNotFound,
        `nothing in system ${graph.system.name} fits the report; name the entry (--entry)`,
      );
    }
    const { minConfidence, ambiguityMargin } = this.config.triage;
    const close = others.filter(
      ({ confidence }) => top.confidence - confidence < ambiguityMargin - CONFIDENCE_TOLERANCE,
    );
    const ambiguous =
      top.confidence < minConfidence || this.hasRival(graph, top, close, roles);

    if (!ambiguous) {
      return this.entry(this.vertex(graph, top.vertex), EntryMethod.Model, candidates);
    }
    const chosen = await options.chooseEntry?.(candidates);
    const candidate = candidates.find(({ vertex }) => vertex === chosen);

    if (candidate === undefined) {
      throw new AmbiguousEntryError(candidates);
    }
    return this.entry(this.vertex(graph, candidate.vertex), EntryMethod.Prompt, candidates);
  }

  /**
   * A close candidate whose scope lies within the top one's is the same investigation seen
   * closer up, so only one that reaches beyond it makes the choice ambiguous (ADR 0016).
   */
  private hasRival(
    graph: SystemGraph,
    top: IEntryCandidate,
    close: readonly IEntryCandidate[],
    roles: readonly IndicatorRole[],
  ): boolean {
    if (close.length === 0) {
      return false;
    }
    const covered = new Set(this.scopedVertices(graph, top.vertex, roles));

    return close.some(({ vertex }) =>
      this.scopedVertices(graph, vertex, roles).some((scoped) => !covered.has(scoped)),
    );
  }

  private scopedVertices(
    graph: SystemGraph,
    entry: string,
    roles: readonly IndicatorRole[],
  ): string[] {
    return this.scopes.resolve(graph, entry, roles).vertices.map(({ vertex }) => vertex);
  }

  private named(
    graph: SystemGraph,
    vertex: string,
  ): { readonly symptom: ISymptom; readonly entry: IInvestigationEntry } {
    return {
      symptom: { roles: ALL_ROLES, method: SymptomMethod.Unclassified },
      entry: this.entry(this.vertex(graph, vertex), EntryMethod.Flag, []),
    };
  }

  private vertex(graph: SystemGraph, id: string): IGraphVertex {
    const vertex = graph.vertex(id);

    if (vertex === undefined || !NAMEABLE_TYPES.has(vertex.type)) {
      throw new InvestigationError(
        InvestigationErrorCode.EntryNotFound,
        `'${id}' is not a functionality, flow, step, dependency, component or member of system ${graph.system.name}; ids look like component:checkout`,
      );
    }
    return vertex;
  }

  private entry(
    vertex: IGraphVertex,
    method: EntryMethod,
    candidates: IInvestigationEntry['candidates'],
  ): IInvestigationEntry {
    const candidate = candidates.find((option) => option.vertex === vertex.id);

    return {
      vertex: vertex.id,
      type: vertex.type,
      method,
      confidence: candidate?.confidence,
      reason: candidate?.reason,
      candidates,
    };
  }
}
