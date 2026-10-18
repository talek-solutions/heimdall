import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { isHeimdallError, type ErrorResponse } from '@heimdall/core';
import {
  LlmError,
  LlmErrorCode,
  type ILLMCallInterceptor,
  type ILLMProviderMessageRequest,
  type ILLMProviderMessageResponse,
  type LlmChatCall,
} from '@heimdall/llm';
import {
  TelemetryError,
  TelemetryErrorCode,
  type ITelemetryCall,
  type ITelemetrySourceInterceptor,
} from '@heimdall/telemetry';
import type { ITranscriptConfig } from '../config/transcript-config.model';
import { ReplayedError, TranscriptError, TranscriptErrorCode } from '../errors';
import { recordedVariables } from '../format/environment';
import { canonical, snapshot } from '../format/transcript.codec';
import type {
  IModelExchange,
  IPinnedValue,
  ITelemetryExchange,
  ITranscript,
  ITranscriptCommand,
  ITranscriptOutcome,
} from '../format/transcript.interface';
import { TranscriptStore } from '../store/transcript.store';
import { TranscriptMode, TranscriptPin, TranscriptVersion } from '../transcript.enums';
import { TRANSCRIPT_CONFIG } from '../transcript.tokens';

export interface ITranscriptBegin {
  readonly heimdall: string;
  readonly command: ITranscriptCommand;
  readonly manifest: string;
  readonly datasources: unknown;
  readonly env: NodeJS.ProcessEnv;
}

/** Where the transcript went, or why it could not be written: never a reason to fail the run. */
export interface ITranscriptSaved {
  readonly path?: string | undefined;
  readonly warning?: string | undefined;
}

interface IReplayState {
  readonly from: ITranscript;
  readonly output: string | undefined;
  llmCursor: number;
  readonly telemetry: Map<string, ITelemetryExchange[]>;
  readonly used: Map<string, number>;
}

const LLM_CODES: ReadonlySet<string> = new Set(Object.values(LlmErrorCode));
const TELEMETRY_CODES: ReadonlySet<string> = new Set(Object.values(TelemetryErrorCode));
const UNEXPECTED = 'UNEXPECTED_ERROR';

/**
 * One run's transcript (ADR 0007). It sees every model call and every redacting-source call
 * through the interceptor hooks of `@heimdall/llm` and `@heimdall/telemetry`. In record mode
 * it keeps them; in replay mode it answers them from the recorded transcript, so nothing reaches
 * a model or a backend. Idle until `begin`.
 */
@Injectable()
export class TranscriptSession implements ILLMCallInterceptor, ITelemetrySourceInterceptor {
  private readonly replay: IReplayState | undefined;
  private active = false;
  private disabled = false;
  private finished = false;
  private started: Omit<ITranscript, 'model' | 'telemetry' | 'outcome' | 'pins'> | undefined;
  private readonly pins: Record<string, IPinnedValue> = {};
  private readonly model: IModelExchange[] = [];
  private readonly telemetry: ITelemetryExchange[] = [];
  private readonly events: unknown[] = [];

  constructor(
    @Inject(TRANSCRIPT_CONFIG) private readonly config: ITranscriptConfig,
    private readonly store: TranscriptStore,
  ) {
    this.replay =
      config.replay === undefined
        ? undefined
        : this.loadReplay(config.replay.from, config.replay.output);
  }

  get mode(): TranscriptMode {
    if (this.replay !== undefined) {
      return TranscriptMode.Replay;
    }
    return this.config.record && !this.disabled ? TranscriptMode.Record : TranscriptMode.Off;
  }

  /** The transcript being replayed, if any. */
  get replaying(): ITranscript | undefined {
    return this.replay?.from;
  }

  /** For `--no-record`: this run keeps nothing. Has no effect on a replay. */
  disable(): void {
    this.disabled = true;
  }

  begin(input: ITranscriptBegin): void {
    if (this.mode === TranscriptMode.Off) {
      return;
    }
    this.active = true;
    this.started = {
      version: TranscriptVersion.V1,
      meta: {
        heimdall: input.heimdall,
        recordedAt: new Date().toISOString(),
        command: input.command,
        manifest: {
          sha256: createHash('sha256').update(input.manifest).digest('hex'),
          content: input.manifest,
        },
        datasources: snapshot(input.datasources),
      },
      environment: { variables: recordedVariables(input.env) },
    };
  }

  /**
   * A value the run takes from outside the code (the clock, the resolved sources, an answer typed
   * at a prompt): recorded the first time, then always the same; in replay, the recorded one.
   */
  pin<T>(key: TranscriptPin, compute: () => T): T {
    if (this.replay !== undefined) {
      return this.replayPin(key);
    }
    if (!this.active) {
      return compute();
    }
    if (!(key in this.pins)) {
      try {
        this.pins[key] = { value: snapshot(compute()) };
      } catch (error) {
        this.pins[key] = { error: responseOf(error) };
        throw error;
      }
    }
    return unpin<T>(this.pins[key]);
  }

  async pinAsync<T>(key: TranscriptPin, compute: () => Promise<T>): Promise<T> {
    if (this.replay !== undefined) {
      return this.replayPin(key);
    }
    if (!this.active || key in this.pins) {
      return this.active ? unpin<T>(this.pins[key]) : compute();
    }
    try {
      this.pins[key] = { value: snapshot(await compute()) };
    } catch (error) {
      this.pins[key] = { error: responseOf(error) };
      throw error;
    }
    return unpin<T>(this.pins[key]);
  }

  hasPin(key: TranscriptPin): boolean {
    return this.replay !== undefined && key in this.replay.from.pins;
  }

  event(event: unknown): void {
    if (this.active) {
      this.events.push(snapshot(event));
    }
  }

  async chat(
    request: ILLMProviderMessageRequest,
    next: LlmChatCall,
  ): Promise<ILLMProviderMessageResponse> {
    if (this.replay !== undefined) {
      return this.replayChat(this.replay, request);
    }
    if (!this.active) {
      return next(request);
    }
    const call = this.model.length + 1;
    const recorded = snapshot(request);

    try {
      const response = await next(request);
      const kept: ILLMProviderMessageResponse = { ...response };

      delete kept.raw;
      this.model.push({ call, request: recorded, response: snapshot(kept) });
      return response;
    } catch (error) {
      this.model.push({ call, request: recorded, error: responseOf(error) });
      throw error;
    }
  }

  async intercept<T>(call: ITelemetryCall, run: () => Promise<T>): Promise<T> {
    if (this.replay !== undefined) {
      return this.replayTelemetry(this.replay, call);
    }
    if (!this.active) {
      return run();
    }
    try {
      const result = await run();

      this.telemetry.push({ ...snapshot(call), result: snapshot(result) });
      return result;
    } catch (error) {
      this.telemetry.push({ ...snapshot(call), error: responseOf(error) });
      throw error;
    }
  }

  /** Writes the transcript: to the runs directory, or in replay to the requested output. */
  finish(outcome: Omit<ITranscriptOutcome, 'events'>): ITranscriptSaved {
    if (!this.active || this.finished || this.started === undefined) {
      return {};
    }
    this.finished = true;
    const transcript: ITranscript = {
      ...this.started,
      pins: this.pins,
      model: this.model,
      // Parallel tool calls finish in any order; sorted, two recordings of a run are equal text.
      telemetry: [...this.telemetry].sort((a, b) =>
        canonical(identity(a)).localeCompare(canonical(identity(b))),
      ),
      outcome: { events: this.events, ...snapshot(outcome) },
    };

    try {
      if (this.replay === undefined) {
        return { path: this.store.save(transcript) };
      }
      if (this.replay.output !== undefined) {
        this.store.write(this.replay.output, transcript);
      }
      return { path: this.replay.output };
    } catch (error) {
      return {
        warning: `transcript not written: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private loadReplay(from: string, output: string | undefined): IReplayState {
    const transcript = this.store.read(from);
    const telemetry = new Map<string, ITelemetryExchange[]>();

    for (const exchange of transcript.telemetry) {
      const key = canonical(identity(exchange));
      telemetry.set(key, [...(telemetry.get(key) ?? []), exchange]);
    }
    return { from: transcript, output, llmCursor: 0, telemetry, used: new Map() };
  }

  private replayPin<T>(key: TranscriptPin): T {
    const pinned = this.replay?.from.pins[key];

    if (pinned === undefined) {
      throw new TranscriptError(
        TranscriptErrorCode.ReplayMiss,
        `the replayed run needs '${key}', which the recorded run never took`,
      );
    }
    this.pins[key] = snapshot(pinned);
    return unpin<T>(pinned);
  }

  private async replayChat(
    replay: IReplayState,
    request: ILLMProviderMessageRequest,
  ): Promise<ILLMProviderMessageResponse> {
    const recorded = replay.from.model[replay.llmCursor];
    const call = replay.llmCursor + 1;

    replay.llmCursor += 1;
    if (recorded === undefined) {
      const error = new TranscriptError(
        TranscriptErrorCode.ReplayExhausted,
        `the replayed run made model call ${call}; the recorded run made ${replay.from.model.length}`,
      );
      this.model.push({ call, request: snapshot(request), error: error.toResponse() });
      throw error;
    }
    this.model.push({
      call,
      request: snapshot(request),
      ...(recorded.response === undefined ? {} : { response: snapshot(recorded.response) }),
      ...(recorded.error === undefined ? {} : { error: recorded.error }),
    });
    if (recorded.error !== undefined) {
      throw raise(recorded.error);
    }
    return snapshot(recorded.response as ILLMProviderMessageResponse);
  }

  private async replayTelemetry<T>(replay: IReplayState, call: ITelemetryCall): Promise<T> {
    const key = canonical(identity(call));
    const used = replay.used.get(key) ?? 0;
    const recorded = replay.telemetry.get(key)?.[used];

    replay.used.set(key, used + 1);
    if (recorded === undefined) {
      const error = new TranscriptError(
        TranscriptErrorCode.ReplayMiss,
        `the recorded run never called ${call.operation} with ${canonical(call.request)}`,
      );
      this.telemetry.push({ ...snapshot(call), error: error.toResponse() });
      throw error;
    }
    this.telemetry.push(snapshot(recorded));
    if (recorded.error !== undefined) {
      throw raise(recorded.error);
    }
    return snapshot(recorded.result) as T;
  }
}

function unpin<T>(pinned: IPinnedValue | undefined): T {
  if (pinned?.error !== undefined) {
    throw raise(pinned.error);
  }
  return snapshot(pinned?.value) as T;
}

/** What makes two telemetry calls the same call. */
function identity(call: Pick<ITelemetryCall, 'operation' | 'source' | 'request'>): unknown {
  return { operation: call.operation, source: call.source, request: call.request };
}

function responseOf(error: unknown): ErrorResponse {
  if (isHeimdallError(error)) {
    return error.toResponse();
  }
  return { errorCode: UNEXPECTED, message: error instanceof Error ? error.message : String(error) };
}

/** A recorded failure, raised as the same kind of error, so it maps to the same exit code. */
function raise({ errorCode, message = '' }: ErrorResponse): Error {
  if (LLM_CODES.has(errorCode)) {
    return new LlmError(errorCode as LlmErrorCode, message);
  }
  if (TELEMETRY_CODES.has(errorCode)) {
    return new TelemetryError(errorCode as TelemetryErrorCode, message);
  }
  return errorCode === UNEXPECTED ? new Error(message) : new ReplayedError(errorCode, message);
}
