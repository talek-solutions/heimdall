import { Inject } from '@nestjs/common';
import { LLM_TOOL_PORT } from './llm.tokens';

export const InjectLlmToolPort = (): ParameterDecorator => Inject(LLM_TOOL_PORT);
