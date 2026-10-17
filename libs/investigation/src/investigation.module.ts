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
import { InvestigationExecutionService } from './execution/investigation-execution.service';
import { PromQlCompiler } from './execution/queries/promql.compiler';
import { MetricsSourceResolver } from './execution/sources/metrics-source.resolver';
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
    CheckRunner,
    ConclusionValidator,
    MetricsSourceResolver,
    InvestigationExecutionService,
  ],
  exports: [InvestigationInitService, InvestigationExecutionService, INVESTIGATION_CONFIG],
})
export class InvestigationModule {}
