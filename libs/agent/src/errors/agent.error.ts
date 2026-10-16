import { HeimdallError } from '@heimdall/core';
import type { BudgetDimension } from '../enums';
import type { IAgentTranscript, IAgentUsage } from '../runner/agent-run.interface';
import { AgentErrorCode } from './agent-error-code.enum';

export class AgentError extends HeimdallError {
  override readonly errorCode: AgentErrorCode;

  constructor(errorCode: AgentErrorCode, message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.errorCode = errorCode;
  }
}

/** Carries what the run did before it stopped, so a caller can still report it. */
export class AgentBudgetExceededError extends AgentError {
  constructor(
    readonly dimension: BudgetDimension,
    readonly usage: IAgentUsage,
    readonly transcript: IAgentTranscript,
  ) {
    super(
      AgentErrorCode.BudgetExceeded,
      `the agent run used its ${dimension} budget before concluding`,
    );
  }
}
