import { Inject } from '@nestjs/common';
import { LLM_PROVIDER } from './llm.tokens';

export const InjectLlmProvider = (): ParameterDecorator => Inject(LLM_PROVIDER);
