import 'reflect-metadata';

export type { IClock, IInvestigationConfig } from './config/investigation-config.model';
export { resolveInvestigationConfig } from './config/investigation-config.resolver';
export * from './enums';
export * from './errors';
export type * from './interfaces';
export type {
  ICheckProblem,
  ICheckResult,
  IEvidenceResult,
  IRoleResult,
} from './execution/checks/check-result.interface';
export { ResultKind } from './execution/checks/result-kind.enum';
export { OperationChange } from './execution/evidence/evidence.enums';
export type * from './execution/evidence/evidence-result.interface';
export {
  ConclusionOutcome,
  MitigationTier,
  ResultVerdict,
} from './execution/conclusion/conclusion.enums';
export type * from './execution/conclusion/conclusion.interface';
export {
  DeviationDirection,
  ObjectiveVerdict,
  PreliminarySignal,
} from './execution/health/health.enums';
export {
  InvestigationExecutionService,
  type IExecuteOptions,
} from './execution/investigation-execution.service';
export type {
  IInvestigationReport,
  IReportRedaction,
} from './execution/investigation-report.interface';
export type { IDroppedFields, IReachedPruned } from './execution/execution.session';
export { InvestigationTool } from './execution/tools/investigation-tool.enum';
export { InvestigationInitService } from './investigation-init.service';
export { InvestigationModule } from './investigation.module';
export { CLOCK, INVESTIGATION_CONFIG } from './investigation.tokens';
