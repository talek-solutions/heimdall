import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { patternRisk, Scrubber } from '@heimdall/config';
import { RedactionTally } from './redaction-tally';
import { Redactor } from './redactor';
import { SCRUBBER_ORDER, SCRUBBER_PATTERNS } from './scrubbers';

/** Documented examples and fakes only, as in the fixtures (libs/telemetry/scenarios). */
const JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
const PEM =
  '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAfakefakefake\n-----END RSA PRIVATE KEY-----';

interface IScrubberCase {
  /** Input → what it becomes. */
  readonly hit: readonly [string, string];
  /** A secret this scrubber does not catch (the design doc's Known miss). */
  readonly miss: string;
  /** Secret-looking text it must leave alone. */
  readonly clean: string;
}

/** `.docs/design/redaction-and-scrubbers.md`, The scrubbers, row for row. */
const CASES: Readonly<Record<Scrubber, IScrubberCase>> = {
  [Scrubber.PrivateKey]: {
    hit: [`key=${PEM} loaded`, 'key=[REDACTED:privateKey] loaded'],
    miss: 'key=MIIEowIBAAKCAQEAfakefakefake',
    clean: '-----BEGIN PUBLIC KEY-----',
  },
  [Scrubber.ConnectionString]: {
    hit: [
      'dsn="postgres://orders_app:s3cr3t-Passw0rd@orders-pg.data.svc:5432/orders"',
      'dsn="postgres://[REDACTED:connectionString]@orders-pg.data.svc:5432/orders"',
    ],
    miss: 'conn=scott/tiger@orcl',
    clean: 'see https://example.com/orders?id=1',
  },
  [Scrubber.BearerToken]: {
    hit: [`authorization="Bearer ${JWT}"`, 'authorization="Bearer [REDACTED:bearerToken]"'],
    miss: 'Authorization: Basic dXNlcjpwYXNzd29yZA==',
    clean: 'the bearer of bad news',
  },
  [Scrubber.Jwt]: {
    hit: [`session=${JWT}`, 'session=[REDACTED:jwt]'],
    miss: 'session=eyJhbGciOiJIUzI1NiJ9.\neyJzdWIiOiIxIn0.c2ln',
    clean: 'eyJ.version.1',
  },
  [Scrubber.AwsAccessKey]: {
    hit: ['access_key_id=AKIAIOSFODNN7EXAMPLE', 'access_key_id=[REDACTED:awsAccessKey]'],
    miss: 'secret=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    clean: 'sku=AKIA1234',
  },
  [Scrubber.Email]: {
    hit: ['customer=jane.doe@example.com', 'customer=[REDACTED:email]'],
    miss: 'customer=jane.doe at example dot com',
    clean: 'release v2@1.0',
  },
};

function only(scrubber: Scrubber): Redactor {
  return new Redactor({ scrubbers: [scrubber], additionalPatterns: [] });
}

describe('Scrubbers: one planted secret, one documented miss and one clean value each', () => {
  for (const scrubber of SCRUBBER_ORDER) {
    const { hit, miss, clean } = CASES[scrubber];

    it(`${scrubber}`, () => {
      const tally = new RedactionTally();
      const redactor = only(scrubber);

      assert.equal(redactor.redact(hit[0], tally), hit[1]);
      assert.equal(redactor.redact(miss, tally), miss, 'the documented miss is not caught');
      assert.equal(redactor.redact(clean, tally), clean, 'no false positive');
      assert.deepEqual(tally.summary().matches, { [scrubber]: 1 });
    });
  }

  it('catches the known false positive of email: an scp-style git remote', () => {
    assert.equal(
      only(Scrubber.Email).redact('git@github.com', new RedactionTally()),
      '[REDACTED:email]',
    );
  });

  it('runs bigger structures first: a bearer header takes its JWT with it', () => {
    const tally = new RedactionTally();
    const all = new Redactor({ scrubbers: Object.values(Scrubber), additionalPatterns: [] });

    assert.equal(
      all.redact(`Authorization: Bearer ${JWT}`, tally),
      'Authorization: Bearer [REDACTED:bearerToken]',
    );
    assert.deepEqual(tally.summary().matches, { [Scrubber.BearerToken]: 1 });
  });

  it('keeps every built-in pattern inside the additionalPatterns rules', () => {
    for (const scrubber of SCRUBBER_ORDER) {
      for (const { source } of SCRUBBER_PATTERNS[scrubber]) {
        assert.equal(patternRisk(source), undefined, `${scrubber}: ${source}`);
      }
    }
  });
});
