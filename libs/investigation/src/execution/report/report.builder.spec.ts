import 'reflect-metadata';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { InconclusiveReason } from '@heimdall/agent';
import { readTranscript, transcriptsDir } from '../../__fixtures__/transcripts/transcript-harness';
import { BlindSpotReason } from '../../enums';
import { ConclusionOutcome, ResultVerdict } from '../conclusion/conclusion.enums';
import type { IInvestigationReport } from '../investigation-report.interface';
import { ReportBuilder, type IReportInput } from './report.builder';
import { BlindSpotTouch, ImpactStatus, ReportSchemaVersion } from './report.enums';

const builder = new ReportBuilder();

/** What execution hands the builder, read back from a committed CI transcript. */
function inputOf(name: string): IReportInput {
  const report = readTranscript(join(transcriptsDir(), `${name}.json`)).outcome
    .report as IInvestigationReport;

  return {
    plan: report.plan,
    results: report.results,
    profiles: report.profiles,
    droppedFields: report.redaction.droppedFields,
    reachedPruned: report.reachedPruned,
    conclusion: report.conclusion,
    usage: report.usage,
  };
}

describe('ReportBuilder: key figures', () => {
  it('leads with the symptom, then the origin, the cause and breached objectives', () => {
    const report = builder.build(inputOf('increased-latency-1'));

    // r1, r2 confirm; r10 is the origin step; r22 is the cause's logs; r19 is orders-pg's breach.
    assert.deepEqual(report.keyFigures, ['r1', 'r2', 'r10', 'r22', 'r19']);
  });

  it("stands the cause's cited logs in for it when the cause has no indicators", () => {
    const report = builder.build(inputOf('increased-latency-1'));
    const r22 = report.results.find(({ result }) => result === 'r22');

    assert.equal(report.conclusion?.cause?.vertex, 'component:orders-reconcile');
    assert.equal(r22?.subject, 'component:orders-reconcile');
    assert.ok(report.keyFigures.includes('r22'));
  });

  it('shows at most five', () => {
    const input = inputOf('increased-latency-1');
    const report = builder.build({
      ...input,
      conclusion: input.conclusion && {
        ...input.conclusion,
        verdicts: input.conclusion.verdicts.map((verdict) => ({
          ...verdict,
          verdict: ResultVerdict.Unhealthy,
        })),
      },
    });

    assert.equal(report.keyFigures.length, 5);
  });

  it('keeps the symptom and breached objectives when the agent ended without a conclusion', () => {
    const report = builder.build({
      ...inputOf('increased-latency-1'),
      conclusion: undefined,
      agentReason: InconclusiveReason.NoStopCall,
    });

    assert.equal(report.outcome, ConclusionOutcome.Inconclusive);
    assert.equal(report.agentReason, InconclusiveReason.NoStopCall);
    assert.deepEqual(report.keyFigures, ['r1', 'r2', 'r19']);
    assert.deepEqual(report.blindSpots, []);
  });

  it('has none when nothing is unhealthy', () => {
    assert.deepEqual(builder.build(inputOf('healthy-baseline')).keyFigures, []);
  });
});

describe('ReportBuilder: blind spots the conclusion leans on', () => {
  it('flags a cause that emits no telemetry', () => {
    assert.deepEqual(builder.build(inputOf('error-burst-30s')).blindSpots, [
      {
        vertex: 'component:payment-provider',
        reason: BlindSpotReason.NoTelemetry,
        touches: BlindSpotTouch.Cause,
      },
    ]);
  });

  it('flags a cause with telemetry but no indicators, and leaves the rest of the plan out', () => {
    const input = inputOf('increased-latency-1');
    const report = builder.build(input);

    assert.equal(input.plan.blindSpots.length, 4);
    assert.deepEqual(report.blindSpots, [
      {
        vertex: 'component:orders-reconcile',
        reason: BlindSpotReason.NoIndicators,
        touches: BlindSpotTouch.Cause,
      },
    ]);
  });

  it('flags the origin step, and the subject of a cited result', () => {
    const input = inputOf('increased-latency-1');
    const report = builder.build({
      ...input,
      plan: {
        ...input.plan,
        blindSpots: [
          { vertex: 'step:place-order#3', reason: BlindSpotReason.NoIndicators },
          { vertex: 'component:checkout', reason: BlindSpotReason.NoIndicators },
        ],
      },
    });

    assert.deepEqual(
      report.blindSpots.map(({ vertex, touches }) => [vertex, touches]),
      [
        ['step:place-order#3', BlindSpotTouch.Origin],
        ['component:checkout', BlindSpotTouch.Evidence],
      ],
    );
  });

  it('lists none without a conclusion: there is nothing to lean on', () => {
    const report = builder.build({ ...inputOf('error-burst-30s'), conclusion: undefined });

    assert.deepEqual(report.blindSpots, []);
  });
});

describe('ReportBuilder: impact, never a cause', () => {
  it('reports the flows a component serves once their impact checks ran', () => {
    const report = builder.build(inputOf('payments-impact'));

    assert.equal(report.impact.status, ImpactStatus.Checked);
    assert.deepEqual(report.impact.subjects, [
      { vertex: 'flow:place-order', verdict: ResultVerdict.Healthy, results: ['r7'] },
    ]);
  });

  it('keeps an unhealthy impact result out of the key figures', () => {
    const input = inputOf('payments-impact');
    const report = builder.build({
      ...input,
      conclusion: input.conclusion && {
        ...input.conclusion,
        verdicts: [
          ...input.conclusion.verdicts.filter(({ result }) => result !== 'r7'),
          { result: 'r7', verdict: ResultVerdict.Unhealthy, reason: 'errors anomalous' },
        ],
      },
    });

    assert.equal(report.impact.subjects[0]?.verdict, ResultVerdict.Unhealthy);
    assert.ok(!report.keyFigures.includes('r7'));
  });

  it('says impact was not run when its checks were planned and none ran', () => {
    const input = inputOf('payments-impact');
    const report = builder.build({
      ...input,
      results: input.results.filter(({ result }) => result !== 'r7'),
    });

    assert.equal(report.impact.status, ImpactStatus.NotRun);
    assert.deepEqual(report.impact.subjects, [
      { vertex: 'flow:place-order', verdict: null, results: [] },
    ]);
  });

  it('says impact was not planned when the scope has no impact flows', () => {
    const report = builder.build(inputOf('increased-latency-1'));

    assert.deepEqual(report.impact, { status: ImpactStatus.NotPlanned, subjects: [] });
  });
});

describe('ReportBuilder: the contract', () => {
  it('stamps the schema version and passes the profiles through untouched', () => {
    const input = inputOf('increased-latency-1');
    const report = builder.build(input);

    assert.equal(report.schemaVersion, ReportSchemaVersion.V1);
    assert.equal(report.profiles, input.profiles);
  });
});
