import type { ErrorResponse } from '@heimdall/core';
import type { ILLMProviderMessageRequest, ILLMProviderMessageResponse } from '@heimdall/llm';
import type { TelemetryOperation } from '@heimdall/telemetry';
import type { TranscriptVersion } from '../transcript.enums';

/** The command as it was invoked; replay invokes it again the same way. */
export interface ITranscriptCommand {
  readonly query: string;
  readonly environment?: string | undefined;
  readonly since?: string | undefined;
  readonly entry?: string | undefined;
  readonly planOnly: boolean;
}

export interface ITranscriptMeta {
  readonly heimdall: string;
  readonly recordedAt: string;
  readonly command: ITranscriptCommand;
  readonly manifest: { readonly sha256: string; readonly content: string };
  /** Which backends were fixtures, and the scenario and anchor when one was. */
  readonly datasources: unknown;
  /** Created when the run starts. Absent on transcripts recorded before ADR 0019 was built. */
  readonly runId?: string | undefined;
  /** The commit of the Heimdall checkout; `null` outside one (ADR 0022). */
  readonly commit?: string | null | undefined;
  /** Written only when the checkout had uncommitted changes. */
  readonly dirty?: true | undefined;
}

/** One model call, in order. `raw` provider responses are not kept. */
export interface IModelExchange {
  readonly call: number;
  readonly request: ILLMProviderMessageRequest;
  readonly response?: ILLMProviderMessageResponse | undefined;
  readonly error?: ErrorResponse | undefined;
}

/** One redacting-source call: the request as plain JSON and what the source returned. */
export interface ITelemetryExchange {
  readonly operation: TelemetryOperation;
  readonly source: string;
  readonly request: Readonly<Record<string, unknown>>;
  readonly result?: unknown;
  readonly error?: ErrorResponse | undefined;
  /** The results this call served (ADR 0020). Absent on a run recorded before the link. */
  readonly resultIds?: readonly string[] | undefined;
}

export interface ITranscriptOutcome {
  /** The investigation events, without the final report (it is below). */
  readonly events: readonly unknown[];
  readonly plan?: unknown;
  readonly report?: unknown;
  readonly error?: ErrorResponse | undefined;
}

/** A pinned value, or the error computing it raised. */
export type IPinnedValue =
  | { readonly value: unknown; readonly error?: undefined }
  | { readonly error: ErrorResponse; readonly value?: undefined };

/** `.docs/design/replay-and-evals.md`, The transcript. */
export interface ITranscript {
  readonly version: TranscriptVersion;
  readonly meta: ITranscriptMeta;
  /** Allowlisted variables only (`environment.ts`); never keys or tokens. */
  readonly environment: { readonly variables: Readonly<Record<string, string>> };
  readonly pins: Readonly<Record<string, IPinnedValue>>;
  readonly model: readonly IModelExchange[];
  readonly telemetry: readonly ITelemetryExchange[];
  readonly outcome: ITranscriptOutcome;
}
