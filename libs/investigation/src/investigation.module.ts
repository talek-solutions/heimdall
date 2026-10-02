import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SystemGraphCompiler } from '@heimdall/core/graph';
import { LlmModule } from '@heimdall/llm';
import { TelemetryDatasourceConfigModule } from '@heimdall/telemetry';
import { clockProvider } from './config/clock.provider';
import { investigationConfigProvider } from './config/investigation-config.provider';
import { InvestigationIntake } from './intake/investigation.intake';
import { InvestigationInitService } from './investigation-init.service';
import { INVESTIGATION_CONFIG } from './investigation.tokens';
import { CheckPlanner } from './plan/check.planner';
import { ScopeResolver } from './scope/scope.resolver';
import { SymptomTriage } from './triage/symptom.triage';

@Module({
  imports: [ConfigModule, LlmModule, TelemetryDatasourceConfigModule],
  providers: [
    investigationConfigProvider,
    clockProvider,
    SystemGraphCompiler,
    InvestigationIntake,
    SymptomTriage,
    ScopeResolver,
    CheckPlanner,
    InvestigationInitService,
  ],
  exports: [InvestigationInitService, INVESTIGATION_CONFIG],
})
export class InvestigationModule {}
