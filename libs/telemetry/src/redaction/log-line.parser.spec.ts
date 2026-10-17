import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LogLineFormat, parseLogLine } from './log-line.parser';

describe('parseLogLine', () => {
  it('reads logfmt, unquoting values', () => {
    const { format, fields } = parseLogLine(
      'level=error msg="acquire connection timeout" pool=orders-pg error="pool \\"exhausted\\""',
    );

    assert.equal(format, LogLineFormat.Logfmt);
    assert.equal(fields.get('msg'), 'acquire connection timeout');
    assert.equal(fields.get('error'), 'pool "exhausted"');
    assert.equal(fields.get('pool'), 'orders-pg');
  });

  it('reads a JSON object, dotting nested keys to three levels', () => {
    const { format, fields } = parseLogLine(
      '{"level":"warn","msg":"slow","http":{"status":503,"req":{"headers":{"auth":"x"}}}}',
    );

    assert.equal(format, LogLineFormat.Json);
    assert.equal(fields.get('http.status'), '503');
    assert.equal(fields.get('http.req.headers'), '{"auth":"x"}');
  });

  it('treats a sentence with a stray pair, and Postgres output, as unstructured', () => {
    for (const line of [
      'connection failed after retries=3 to the primary',
      'LOG:  duration: 5012.211 ms  statement: UPDATE orders SET status = $1 WHERE id = $2',
      '{not json',
    ]) {
      assert.equal(parseLogLine(line).format, LogLineFormat.Unstructured, line);
      assert.equal(parseLogLine(line).fields.size, 0);
    }
  });
});
