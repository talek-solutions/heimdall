import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAX_PATTERN_LENGTH, PatternRisk, patternRisk } from './pattern-safety';

describe('patternRisk: the additionalPatterns rules of redaction-and-scrubbers.md', () => {
  it('accepts linear patterns, including exact repetition of a group', () => {
    for (const pattern of [
      'ik_[a-zA-Z0-9]{32}',
      '\\bsk_(?:live|test)_[A-Za-z0-9]{24,}',
      '(?:-[a-z]{4}){3}',
      '(ab)+c',
      '\\(a+\\)+',
      '[(+|]+x',
      '(?i:token)=\\S+',
    ]) {
      assert.equal(patternRisk(pattern), undefined, pattern);
    }
  });

  it('refuses a repeated group that holds a quantifier or an alternation', () => {
    for (const pattern of ['(a+)+b', '(?:a|aa)*b', 'x(\\w+\\s?)*$', '((a|b)c)+', '(x{2,})+y']) {
      assert.equal(patternRisk(pattern), PatternRisk.NestedRepetition, pattern);
    }
  });

  it('refuses backreferences, numbered or named', () => {
    assert.equal(patternRisk('(a)x\\1'), PatternRisk.Backreference);
    assert.equal(patternRisk('(?<q>["\'])x\\k<q>'), PatternRisk.Backreference);
  });

  it('refuses invalid, over-long and empty-matching patterns', () => {
    assert.equal(patternRisk('(unclosed'), PatternRisk.Invalid);
    assert.equal(patternRisk('a'.repeat(MAX_PATTERN_LENGTH + 1)), PatternRisk.TooLong);
    assert.equal(patternRisk('a*'), PatternRisk.MatchesEmpty);
  });
});
