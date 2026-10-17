import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Scrubber } from '@heimdall/config';
import { RedactionTally } from './redaction-tally';
import { MAX_VALUE_LENGTH, Redactor } from './redactor';

describe('Redactor', () => {
  it('applies additional patterns after the built-ins, with their name as the token', () => {
    const tally = new RedactionTally();
    const redactor = new Redactor({
      scrubbers: [Scrubber.Email],
      additionalPatterns: [{ name: 'internal-api-key', pattern: 'ik_[a-zA-Z0-9]{32}' }],
    });

    assert.equal(
      redactor.redact(`key=ik_${'a'.repeat(32)} owner=ops@example.com`, tally),
      'key=[REDACTED:internal-api-key] owner=[REDACTED:email]',
    );
    assert.deepEqual(tally.summary().matches, { email: 1, 'internal-api-key': 1 });
  });

  it('applies only the scrubbers the config enables', () => {
    const redactor = new Redactor({ scrubbers: [], additionalPatterns: [] });

    assert.equal(redactor.redact('ops@example.com', new RedactionTally()), 'ops@example.com');
  });

  it('cuts a long value at the last whitespace, so a token split by the cut does not survive in part', () => {
    const tally = new RedactionTally();
    const redactor = new Redactor({ scrubbers: Object.values(Scrubber), additionalPatterns: [] });
    const padding = 'x '.repeat((MAX_VALUE_LENGTH - 10) / 2);
    const value = `${padding}AKIAIOSFODNN7EXAMPLE tail`;
    const redacted = redactor.redact(value, tally);

    assert.ok(redacted.length <= MAX_VALUE_LENGTH + 1);
    assert.ok(redacted.endsWith('…'));
    assert.equal(redacted.includes('AKIA'), false);
    assert.equal(tally.summary().truncated, 1);
  });

  it('redacts an unterminated private key to the end of a cut value', () => {
    const redactor = new Redactor({ scrubbers: [Scrubber.PrivateKey], additionalPatterns: [] });

    assert.equal(
      redactor.redact('tls -----BEGIN PRIVATE KEY----- MIIEvfake', new RedactionTally()),
      'tls [REDACTED:privateKey]',
    );
  });
});
