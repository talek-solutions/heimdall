import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FieldSemantic } from '@heimdall/config';
import { LogLineFormat, type ILogRecord, type RedactedText } from '@heimdall/telemetry';
import type { ILogTemplate } from './evidence-result.interface';
import { classifyTemplates, confirmationCandidates, tallyTemplates } from './log-evidence';
import { logTemplate, templateId, templateLiteral } from './log-template';

function line(message: string, at = 0, fields: Record<string, string> = {}): ILogRecord {
  return {
    timestampMs: at,
    format: LogLineFormat.Logfmt,
    fields: { [FieldSemantic.Message]: message, ...fields } as unknown as Record<
      string,
      RedactedText
    >,
  };
}

function lines(message: string, count: number, fields: Record<string, string> = {}): ILogRecord[] {
  return Array.from({ length: count }, (_, index) => line(`${message}`, index * 1_000, fields));
}

const OPTIONS = { correlationKey: undefined, searched: false };

describe('log templates (log-and-trace-evidence.md, Templates)', () => {
  it('masks tokens with digits or id-like runs, collapses runs, and keeps redaction tokens', () => {
    assert.equal(
      logTemplate(
        'LOG:  process 48211 still waiting for ShareLock on transaction 99182731 after 1234.5 ms',
      ),
      'LOG: process <*> still waiting for ShareLock on transaction <*> after <*> ms',
    );
    assert.equal(logTemplate('session deadbeefdeadbeefcafe 12 34 closed'), 'session <*> closed');
    assert.equal(logTemplate('token [REDACTED:jwt] refused'), 'token [REDACTED:jwt] refused');
  });

  it('names a template by a stable hash, and finds its longest literal run', () => {
    assert.equal(templateId('slow query'), templateId('slow query'));
    assert.equal(templateId('slow query').length, 8);
    assert.equal(
      templateLiteral(
        'LOG: process <*> still waiting for ShareLock on transaction <*> after <*> ms',
      ),
      'still waiting for ShareLock on transaction',
    );
    assert.equal(templateLiteral('ok <*> done'), undefined, 'too short to mean anything');
  });
});

describe('classifyTemplates (log-and-trace-evidence.md, Classes)', () => {
  const baseline = [...lines('request completed', 90), ...lines('cart validated', 10)];

  it('calls a template new when the baseline lacks it and a baseline query agrees', () => {
    const tallies = tallyTemplates(
      {
        window: [...lines('request completed', 60), ...lines('acquire connection timeout', 40)],
        baseline,
      },
      undefined,
    );
    const [candidate] = confirmationCandidates(tallies, baseline.length);
    const { templates } = classifyTemplates(
      tallies,
      { window: 100, baseline: 100 },
      new Map([[candidate?.id ?? '', true]]),
      OPTIONS,
    );

    assert.equal(candidate?.template, 'acquire connection timeout');
    assert.deepEqual(
      templates.new.map(({ template, confirmedAbsent }) => [template, confirmedAbsent]),
      [['acquire connection timeout', true]],
    );
    assert.equal(templates.new[0]?.examples.length, 2, 'first and last occurrence');
    assert.deepEqual(
      templates.vanished.map(({ template }) => template),
      ['cart validated'],
    );
  });

  it('judges a "new" template the baseline query did find as surging against a floored baseline', () => {
    const tallies = tallyTemplates(
      { window: [...lines('request completed', 60), ...lines('retrying payment', 40)], baseline },
      undefined,
    );
    const [candidate] = confirmationCandidates(tallies, baseline.length);
    const { templates } = classifyTemplates(
      tallies,
      { window: 100, baseline: 100 },
      new Map([[candidate?.id ?? '', false]]),
      OPTIONS,
    );

    assert.equal(templates.new.length, 0);
    assert.deepEqual(
      templates.surging.map(({ template, confirmedAbsent }) => [template, confirmedAbsent]),
      [['retrying payment', false]],
    );
  });

  it('needs a threefold share and five lines to surge, and two lines to be new', () => {
    const tallies = tallyTemplates(
      {
        window: [
          ...lines('request completed', 80),
          ...lines('cart validated', 10),
          ...lines('stock low', 4),
          line('one-off failure happened'),
        ],
        baseline: [
          ...lines('request completed', 97),
          ...lines('cart validated', 2),
          line('stock low'),
        ],
      },
      undefined,
    );
    const { templates } = classifyTemplates(
      tallies,
      { window: 95, baseline: 100 },
      new Map(),
      OPTIONS,
    );

    assert.deepEqual(
      templates.surging.map(({ template }) => template),
      ['cart validated'],
    );
    assert.deepEqual(templates.steady.map(({ template }) => template).sort(), [
      'one-off failure happened',
      'request completed',
      'stock low',
    ]);
  });

  it('treats every line of a stream absent from the baseline as new, and lists correlation values', () => {
    const tallies = tallyTemplates(
      { window: lines('reconciling batch', 3, { orderId: 'o-1' }), baseline: [] },
      'orderId',
    );
    const result = classifyTemplates(tallies, { window: 3, baseline: 0 }, new Map(), {
      correlationKey: 'orderId',
      searched: false,
    });

    assert.equal(result.templates.new[0]?.confirmedAbsent, true);
    assert.deepEqual(result.correlation, { key: 'orderId', values: ['o-1'] });
  });

  it('shows examples for steady templates only in a search for literal text', () => {
    const tallies = tallyTemplates(
      { window: lines('token refresh failed', 5), baseline: lines('token refresh failed', 5) },
      undefined,
    );
    const plain = classifyTemplates(tallies, { window: 5, baseline: 5 }, new Map(), OPTIONS);
    const searched = classifyTemplates(tallies, { window: 5, baseline: 5 }, new Map(), {
      correlationKey: undefined,
      searched: true,
    });

    assert.equal('examples' in (plain.templates.steady[0] ?? {}), false);
    assert.equal((searched.templates.steady[0] as ILogTemplate).examples.length, 2);
  });
});
