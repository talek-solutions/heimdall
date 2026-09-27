import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FixtureRequestError } from '../fixture-backend';
import { compileLineFilters, isMetricQuery, rangeSelectorMs } from './logql-query';

describe('isMetricQuery', () => {
  it('recognises range aggregations', () => {
    assert.equal(isMetricQuery('count_over_time({app="x"}[5m])'), true);
    assert.equal(isMetricQuery('sum by (level) (rate({app="x"} |= "err" [1h30m]))'), true);
    assert.equal(isMetricQuery('rate({app="x"}[$__auto])'), true);
  });

  it('ignores brackets inside strings', () => {
    assert.equal(isMetricQuery('{app="x"} |= "[5m]"'), false);
    assert.equal(isMetricQuery('{app="x"} |~ `\\[\\d+m\\]`'), false);
    assert.equal(isMetricQuery('{app="x"}'), false);
  });
});

describe('rangeSelectorMs', () => {
  it('reads the first literal range', () => {
    assert.equal(rangeSelectorMs('count_over_time({a="b"}[5m])'), 300_000);
    assert.equal(rangeSelectorMs('count_over_time({a="b"} |= "[1m]" [30s])'), 30_000);
    assert.equal(rangeSelectorMs('rate({a="b"}[$__auto])'), undefined);
  });
});

describe('compileLineFilters', () => {
  const lines = [
    'level=error msg="acquire connection timeout" pool=orders-pg',
    'level=info msg="request completed" status=200',
    'level=warn msg="Timeout while retrying"',
  ];

  function kept(query: string): string[] {
    const accept = compileLineFilters(query);
    return lines.filter(accept);
  }

  it('applies contains and not-contains filters in sequence', () => {
    assert.deepEqual(kept('{app="x"} |= "timeout"'), [lines[0]]);
    assert.deepEqual(kept('{app="x"} != "timeout" != "Timeout"'), [lines[1]]);
    assert.deepEqual(kept('{app="x"} |= "level=" != "info"'), [lines[0], lines[2]]);
  });

  it('applies regex filters, including a leading (?i)', () => {
    assert.deepEqual(kept('{app="x"} |~ "(?i)timeout"'), [lines[0], lines[2]]);
    assert.deepEqual(kept('{app="x"} !~ `status=\\d+`'), [lines[0], lines[2]]);
  });

  it('keeps every line when there is no filter, and ignores label filters after a parser', () => {
    assert.deepEqual(kept('{app="x"}'), lines);
    assert.deepEqual(kept('{app="x"} | logfmt | level != "info"'), lines);
    assert.deepEqual(kept('{app!="y"}'), lines);
  });

  it('rejects an invalid regex the way Loki does', () => {
    assert.throws(() => compileLineFilters('{app="x"} |~ "("'), FixtureRequestError);
  });
});
