import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LlmModule } from '@heimdall/llm';
import { AGENT_CONFIG } from './agent.tokens';
import { agentClockProvider, agentConfigProvider } from './config/agent-config.provider';
import { AgentRunner } from './runner/agent.runner';

@Module({
  imports: [ConfigModule, LlmModule],
  providers: [agentConfigProvider, agentClockProvider, AgentRunner],
  exports: [AgentRunner, AGENT_CONFIG],
})
export class AgentModule {}
