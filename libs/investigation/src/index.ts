import 'reflect-metadata';

export type { IClock, IInvestigationConfig } from './config/investigation-config.model';
export { resolveInvestigationConfig } from './config/investigation-config.resolver';
export * from './enums';
export * from './errors';
export type * from './interfaces';
export { InvestigationInitService } from './investigation-init.service';
export { InvestigationModule } from './investigation.module';
export { CLOCK, INVESTIGATION_CONFIG } from './investigation.tokens';
