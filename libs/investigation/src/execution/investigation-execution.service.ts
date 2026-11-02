import { Inject, Injectable } from '@nestjs/common';
import {
  AgentEventType,
  AgentOutcome,
  AgentRunner,
  ToolRepository,
  type IAgentEvent,
} from '@heimdall/agent';
import { SystemGraphCompiler } from '@heimdall/core/graph';
import type { IManifestV1 } from '@heimdall/core/manifest';
import { LLMMessageRole, LLMReasoningEffort } from '@heimdall/llm';
import type { IInvestigationConfig } from '../config/investigation-config.model';
import { InvestigationEventType } from '../enums';
import type { IInvestigationEvent, IInvestigationPlan } from '../interfaces';
import { INVESTIGATION_CONFIG } from '../investigation.tokens';
import { INVESTIGATION_SYSTEM_PROMPT, seedMessage } from './agent/investigation.prompt';
import { CheckRunner } from './checks/check.runner';
import { ConclusionValidator } from './conclusion/conclusion.validator';
import { ExecutionSession } from './execution.session';
import type { IInvestigationReport } from './investigation-report.interface';
import { EvidenceRunner } from './evidence/evidence.runner';
import { ReportBuilder } from './report/report.builder';
import { TelemetrySourcesResolver } from './sources/telemetry-sources.resolver';
import { checkIndicatorTool } from './tools/check-indicator.tool';
import { concludeTool } from './tools/conclude.tool';
import { evidenceTools } from './tools/evidence.tools';
import { graphTools } from './tools/graph.tools';
import { runChecksTool } from './tools/run-checks.tool';

const AGENT_NAME = 'heimdall.investigation';

export interface IExecuteOptions {
  readonly onEvent?: ((event: IInvestigationEvent) => void) | undefined;
}

/**
 * The execution phase (ADR 0018): an agent run seeded with the plan, over read-only tools, ending
 * in a conclusion code has checked.
 */
@Injectable()
export class InvestigationExecutionService {
  constructor(
    private readonly compiler: SystemGraphCompiler,
    private readonly agent: AgentRunner,
    private readonly checks: CheckRunner,
    private readonly evidence: EvidenceRunner,
    private readonly validator: ConclusionValidator,
    private readonly sources: TelemetrySourcesResolver,
    private readonly reports: ReportBuilder,
    @Inject(INVESTIGATION_CONFIG) private readonly config: IInvestigationConfig,
  ) {}

  async execute(
    manifest: IManifestV1,
    plan: IInvestigationPlan,
    options: IExecuteOptions = {},
  ): Promise<IInvestigationReport> {
    const emit = (event: IInvestigationEvent): void => options.onEvent?.(event);
    const graph = this.compiler.compile(manifest);
    const environment = graph.system.environments.find(
      (candidate) => candidate.name === plan.environment?.name,
    );
    const session = new ExecutionSession(
      graph,
      plan,
      this.sources.resolve(plan.environment),
      environment?.labels ?? {},
      (result) => emit({ type: InvestigationEventType.CheckCompleted, result }),
    );
    const stop = concludeTool(session, this.validator);
    const run = await this.agent.run({
      agent: AGENT_NAME,
      model: this.config.execution.model,
      system: INVESTIGATION_SYSTEM_PROMPT,
      messages: [{ role: LLMMessageRole.USER, content: seedMessage(plan, graph) }],
      tools: ToolRepository.of([
        runChecksTool(session, this.checks, this.evidence),
        checkIndicatorTool(session, this.checks),
        ...evidenceTools(session, this.evidence),
        ...graphTools(session),
        stop,
      ]),
      stopTool: stop,
      budget: this.config.execution.budget,
      // The default effort of the default model is medium; investigations need more judgement.
      reasoning: { effort: LLMReasoningEffort.HIGH },
      fallbackOnRefusal: true,
      onEvent: (event) => this.forward(event, emit),
    });
    const report = this.reports.build({
      plan,
      results: session.all,
      profiles: session.profiles,
      droppedFields: session.droppedFields,
      reachedPruned: [...session.reachedPruned],
      ...(run.outcome === AgentOutcome.Completed
        ? { conclusion: run.output }
        : { conclusion: undefined, agentReason: run.reason }),
      usage: run.usage,
      traceId: run.traceId,
    });

    emit({ type: InvestigationEventType.Concluded, report });
    return report;
  }

  private forward(event: IAgentEvent, emit: (event: IInvestigationEvent) => void): void {
    if (event.type === AgentEventType.ModelResponded) {
      emit({
        type: InvestigationEventType.AgentTurn,
        turn: event.turn,
        finishReason: event.finishReason,
        toolCalls: event.toolCalls,
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
      });
    }
  }
}
