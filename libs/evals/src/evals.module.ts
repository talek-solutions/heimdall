import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AgentModule } from '@heimdall/agent';
import { Calibrator } from './calibration/calibrator';
import { GoldenCaseLoader } from './cases/golden-case.loader';
import { evalsConfigProvider } from './config/evals-config.provider';
import { EvalService } from './eval.service';
import { EVALS_CONFIG } from './evals.tokens';
import { CaseRunner } from './run/case.runner';
import { Judge } from './score/judge';

@Module({
  imports: [ConfigModule, AgentModule],
  providers: [evalsConfigProvider, GoldenCaseLoader, CaseRunner, Judge, Calibrator, EvalService],
  exports: [EvalService, Calibrator, EVALS_CONFIG],
})
export class EvalsModule {}
