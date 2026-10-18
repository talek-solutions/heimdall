import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import { dirname, join } from 'node:path';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { isHeimdallError, type ErrorResponse } from '@heimdall/core';
import { ManifestReader, ManifestV1Parser } from '@heimdall/core/manifest';
import {
  interceptLlmProvider,
  LLM_CALL_INTERCEPTOR,
  LLM_PROVIDER,
  type ILLMCallInterceptor,
  type ILLMProvider,
} from '@heimdall/llm';
import { TELEMETRY_DATASOURCE_CONFIG, TelemetryEnvVariable } from '@heimdall/telemetry';
import {
  isRecordedVariable,
  TRANSCRIPT_CONFIG,
  TranscriptModule,
  TranscriptSession,
  TranscriptStore,
  type ITranscript,
  type ITranscriptCommand,
  type ITranscriptConfig,
} from '@heimdall/transcript';
import { InvestigationEventType } from '../../enums';
import { InvestigationExecutionService } from '../../execution/investigation-execution.service';
import { InvestigationInitService } from '../../investigation-init.service';
import { InvestigationModule } from '../../investigation.module';
import { referenceManifestPath, ReferenceManifest } from '../investigation.fixture';
import { corroborator, investigator, RuleBasedModel, type Brain } from '../scripted-investigation';
import type { IInvestigationPlan } from '../../interfaces';

export const TRANSCRIPT_ANCHOR = '2026-10-17T08:00:00.000Z';
const HEIMDALL = 'scripted';
const HTTP_BACKENDS = {
  [TelemetryEnvVariable.PrometheusDatasourceType]: 'http',
  [TelemetryEnvVariable.LokiDatasourceType]: 'http',
  [TelemetryEnvVariable.TempoDatasourceType]: 'http',
};

interface IRun {
  readonly config: ITranscriptConfig;
  readonly model: ILLMProvider;
  readonly env: Readonly<Record<string, string>>;
  readonly command: ITranscriptCommand;
  readonly manifest: string;
  readonly onPlan: (plan: IInvestigationPlan) => void;
  /** Every backend over HTTP and `fetch` throwing: a replay must not reach one. */
  readonly sealBackends: boolean;
}

export interface IScriptedCase {
  readonly name: string;
  readonly scenario: string;
  readonly since: string;
  readonly brain: (plan: IInvestigationPlan) => Brain;
  readonly env?: Readonly<Record<string, string>>;
}

/** The committed CI transcripts (ADR 0007): the three fixture walks, by the scripted model. */
export const CI_CASES: readonly IScriptedCase[] = [
  { name: 'error-burst-30s', scenario: 'error-burst-30s', since: '2m', brain: investigator },
  {
    name: 'increased-latency-1',
    scenario: 'increased-latency-1',
    since: '60m',
    brain: corroborator,
    // Fewer sampled lines keep the committed file small; replay reads the same variable back.
    env: { INVESTIGATION_LOG_SAMPLE_LIMIT: '40' },
  },
  { name: 'healthy-baseline', scenario: 'healthy-baseline', since: '60m', brain: investigator },
];

/** `libs/investigation/src/__fixtures__/transcripts`, from wherever the spec runs. */
export function transcriptsDir(): string {
  const relative = join('libs', 'investigation', 'src', '__fixtures__', 'transcripts');
  let directory = __dirname;

  while (!existsSync(join(directory, relative))) {
    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error(`${relative} not found above ${__dirname}`);
    }
    directory = parent;
  }
  return join(directory, relative);
}

/** Runs a case with the scripted model and returns its transcript, with a fixed `recordedAt`. */
export async function recordScripted(scripted: IScriptedCase): Promise<ITranscript> {
  const workspace = mkdtempSync(join(os.tmpdir(), 'heimdall-record-'));
  let brain: Brain = () => [];
  const model = new RuleBasedModel((request, turn) => brain(request, turn));

  try {
    const path = await run({
      config: { record: true, runsDir: workspace, keep: 1 },
      model,
      env: {
        [TelemetryEnvVariable.PrometheusDatasourceType]: 'fixture',
        [TelemetryEnvVariable.LokiDatasourceType]: 'fixture',
        [TelemetryEnvVariable.TempoDatasourceType]: 'fixture',
        [TelemetryEnvVariable.FixtureScenario]: scripted.scenario,
        [TelemetryEnvVariable.FixtureAnchor]: TRANSCRIPT_ANCHOR,
        ...scripted.env,
      },
      command: {
        query: 'checkouts are not working',
        environment: 'prod',
        since: scripted.since,
        entry: 'functionality:checkout',
        planOnly: false,
      },
      manifest: readFileSync(referenceManifestPath(ReferenceManifest.Checkout), 'utf8'),
      onPlan: (plan) => {
        brain = scripted.brain(plan);
      },
      sealBackends: false,
    });
    const transcript = readTranscript(path);

    return stableForCommit(transcript);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

/**
 * Replays a transcript in process: the model and every connector throw if touched, so the run can
 * only be answered from the transcript.
 */
export async function replayInProcess(file: string): Promise<ITranscript> {
  const workspace = mkdtempSync(join(os.tmpdir(), 'heimdall-replay-'));
  const output = join(workspace, 'replayed.json');
  const recorded = readTranscript(file);
  const untouchable: ILLMProvider = {
    chat: async () => {
      throw new Error('a replay called the model');
    },
  };

  try {
    await run({
      config: { record: true, runsDir: workspace, keep: 1, replay: { from: file, output } },
      model: untouchable,
      env: { ...recorded.environment.variables, ...HTTP_BACKENDS },
      command: recorded.meta.command,
      manifest: recorded.meta.manifest.content,
      onPlan: () => undefined,
      sealBackends: true,
    });
    return readTranscript(output);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

export function readTranscript(file: string): ITranscript {
  return new TranscriptStore({ record: false, runsDir: dirname(file), keep: 1 }).read(file);
}

async function run({
  config,
  model,
  env,
  command,
  manifest: manifestText,
  onPlan,
  sealBackends,
}: IRun): Promise<string> {
  const previous = { ...process.env };
  const fetch = globalThis.fetch;

  for (const name of Object.keys(process.env).filter(isRecordedVariable)) {
    delete process.env[name];
  }
  Object.assign(process.env, env);
  try {
    const builder = Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        TranscriptModule,
        InvestigationModule,
      ],
    })
      .overrideProvider(TRANSCRIPT_CONFIG)
      .useValue(config)
      .overrideProvider(LLM_PROVIDER)
      .useFactory({
        factory: (interceptor: ILLMCallInterceptor) => interceptLlmProvider(model, interceptor),
        inject: [LLM_CALL_INTERCEPTOR],
      });

    if (sealBackends) {
      globalThis.fetch = async () => {
        throw new Error('a replay reached a telemetry backend');
      };
    }
    const moduleRef = await builder.compile();
    const session = moduleRef.get(TranscriptSession);
    const manifest = await new ManifestReader(new ManifestV1Parser()).parse(manifestText);
    const onEvent = (event: { readonly type: InvestigationEventType }): void => {
      if (event.type !== InvestigationEventType.Concluded) {
        session.event(event);
      }
    };

    session.begin({
      heimdall: HEIMDALL,
      command,
      manifest: manifestText,
      datasources: moduleRef.get(TELEMETRY_DATASOURCE_CONFIG),
      env: process.env,
    });
    let saved;
    try {
      const plan = await moduleRef.get(InvestigationInitService).prepare(
        manifest,
        {
          query: command.query,
          environment: command.environment,
          since: command.since,
          entry: command.entry,
        },
        { onEvent },
      );

      onPlan(plan);
      const report = await moduleRef
        .get(InvestigationExecutionService)
        .execute(manifest, plan, { onEvent });
      saved = session.finish({ report });
    } catch (error) {
      saved = session.finish({ error: responseOf(error) });
    }
    if (saved.path === undefined) {
      throw new Error(`no transcript was written: ${saved.warning ?? 'unknown'}`);
    }
    return saved.path;
  } finally {
    globalThis.fetch = fetch;
    for (const name of Object.keys(process.env)) {
      if (!(name in previous)) {
        delete process.env[name];
      }
    }
    Object.assign(process.env, previous);
  }
}

/** The two values that vary between recordings of the same run; replay ignores both. */
function stableForCommit(transcript: ITranscript): ITranscript {
  const report = transcript.outcome.report as { usage?: Record<string, unknown> } | undefined;

  return {
    ...transcript,
    meta: { ...transcript.meta, recordedAt: TRANSCRIPT_ANCHOR },
    outcome: {
      ...transcript.outcome,
      ...(report?.usage === undefined
        ? {}
        : { report: { ...report, usage: { ...report.usage, elapsedMs: 0 } } }),
    },
  };
}

function responseOf(error: unknown): ErrorResponse {
  return isHeimdallError(error)
    ? error.toResponse()
    : { errorCode: 'UNEXPECTED_ERROR', message: String(error) };
}
