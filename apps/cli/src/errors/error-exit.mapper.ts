import { AgentErrorCode } from '@heimdall/agent';
import { ExitCode, isHeimdallError, type ErrorResponse } from '@heimdall/core';
import { ManifestErrorCode } from '@heimdall/core/manifest';
import { ConclusionOutcome, InvestigationErrorCode } from '@heimdall/investigation';
import { LlmErrorCode } from '@heimdall/llm';
import { ConfigErrorCode } from '@heimdall/config';
import { TelemetryErrorCode } from '@heimdall/telemetry';
import { CliErrorCode } from './cli-error-code.enum';

/**
 * Error codes that mean "the invocation or its configuration was wrong", as
 * opposed to "something broke". Both are failures; only these are the user's to
 * fix, and .docs/adr/0006 gives them exit code 2 so a pipeline can tell them apart.
 */
const USAGE_ERROR_CODES: ReadonlySet<string> = new Set<string>([
  ...Object.values(ConfigErrorCode),
  ...Object.values(CliErrorCode),
  ...Object.values(ManifestErrorCode),
  InvestigationErrorCode.InvalidConfig,
  InvestigationErrorCode.EmptyQuery,
  InvestigationErrorCode.InvalidWindow,
  InvestigationErrorCode.EnvironmentUnknown,
  InvestigationErrorCode.EntryNotFound,
  InvestigationErrorCode.EntryAmbiguous,
  InvestigationErrorCode.SourceMissing,
  InvestigationErrorCode.SourceUnsupported,
  AgentErrorCode.InvalidConfig,
  LlmErrorCode.INVALID_PROVIDER,
  TelemetryErrorCode.InvalidDatasourceConfig,
  TelemetryErrorCode.FixtureScenarioNotFound,
  TelemetryErrorCode.FixtureScenarioInvalid,
]);

/** Missing or rejected credentials, LLM or telemetry: .docs/adr/0006 reserves exit code 4 for these. */
const PROVIDER_AUTH_ERROR_CODES: ReadonlySet<string> = new Set<string>([
  LlmErrorCode.MISSING_API_KEY,
  LlmErrorCode.AUTHENTICATION_FAILED,
  TelemetryErrorCode.MissingCredentials,
  TelemetryErrorCode.AuthenticationFailed,
]);

/** A run that used up its turns, tokens, tool calls or time: .docs/adr/0006 reserves exit code 5. */
const BUDGET_ERROR_CODES: ReadonlySet<string> = new Set<string>([AgentErrorCode.BudgetExceeded]);

export function exitCodeForError(error: unknown): ExitCode {
  if (!isHeimdallError(error)) {
    return ExitCode.Unexpected;
  }
  if (USAGE_ERROR_CODES.has(error.errorCode)) {
    return ExitCode.Usage;
  }
  if (PROVIDER_AUTH_ERROR_CODES.has(error.errorCode)) {
    return ExitCode.ProviderAuth;
  }
  if (BUDGET_ERROR_CODES.has(error.errorCode)) {
    return ExitCode.BudgetExceeded;
  }
  return ExitCode.Unexpected;
}

/** A finished investigation: 3 is "no signal found", a real outcome rather than a failure (ADR 0006). */
export function exitCodeForOutcome(outcome: ConclusionOutcome): ExitCode {
  return outcome === ConclusionOutcome.CauseFound ? ExitCode.Success : ExitCode.NoSignal;
}

export function toErrorResponse(error: unknown): ErrorResponse {
  if (isHeimdallError(error)) {
    return error.toResponse();
  }
  return {
    errorCode: 'UNEXPECTED_ERROR',
    message: error instanceof Error ? error.message : String(error),
  };
}
