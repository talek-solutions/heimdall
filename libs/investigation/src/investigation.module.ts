import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AgentModule } from '@heimdall/agent';
import { SystemGraphCompiler } from '@heimdall/core/graph';
import { LlmModule } from '@heimdall/llm';
import { TelemetryDatasourceConfigModule, TelemetrySourceModule } from '@heimdall/telemetry';
import { clockProvider } from './config/clock.provider';
import { investigationConfigProvider } from './config/investigation-config.provider';
import { CheckRunner } from './execution/checks/check.runner';
import { ConclusionValidator } from './execution/conclusion/conclusion.validator';
import { EvidenceRunner } from './execution/evidence/evidence.runner';
import { InvestigationExecutionService } from './execution/investigation-execution.service';
import { LogQlCompiler } from './execution/queries/logql.compiler';
import { PromQlCompiler } from './execution/queries/promql.compiler';
import { TraceQlCompiler } from './execution/queries/traceql.compiler';
import { TelemetrySourcesResolver } from './execution/sources/telemetry-sources.resolver';
import { InvestigationIntake } from './intake/investigation.intake';
import { InvestigationInitService } from './investigation-init.service';
import { INVESTIGATION_CONFIG } from './investigation.tokens';
import { CheckPlanner } from './plan/check.planner';
import { ScopeResolver } from './scope/scope.resolver';
import { SymptomTriage } from './triage/symptom.triage';

@Module({
  imports: [
    ConfigModule,
    LlmModule,
    AgentModule,
    TelemetryDatasourceConfigModule,
    TelemetrySourceModule,
  ],
  providers: [
    investigationConfigProvider,
    clockProvider,
    SystemGraphCompiler,
    InvestigationIntake,
    SymptomTriage,
    ScopeResolver,
    CheckPlanner,
    InvestigationInitService,
    PromQlCompiler,
    LogQlCompiler,
    TraceQlCompiler,
    CheckRunner,
    EvidenceRunner,
    ConclusionValidator,
    TelemetrySourcesResolver,
    InvestigationExecutionService,
  ],
  exports: [InvestigationInitService, InvestigationExecutionService, INVESTIGATION_CONFIG],
})
export class InvestigationModule {}
