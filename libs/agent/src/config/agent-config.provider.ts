import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AGENT_CLOCK, AGENT_CONFIG } from '../agent.tokens';
import type { IAgentClock, IAgentConfig } from './agent-config.model';
import { resolveAgentConfig } from './agent-config.resolver';

/** Config enters the lib here only; the runner receives `IAgentConfig`. */
export const agentConfigProvider: Provider<IAgentConfig> = {
  provide: AGENT_CONFIG,
  inject: [ConfigService],
  useFactory: (config: ConfigService): IAgentConfig => resolveAgentConfig(config),
};

export const agentClockProvider: Provider<IAgentClock> = {
  provide: AGENT_CLOCK,
  useValue: { now: (): number => Date.now() },
};
