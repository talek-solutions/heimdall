import type { IRedactionConfig } from '@heimdall/config';
import type { RedactedText } from './redacted-text';
import type { RedactionTally } from './redaction-tally';
import {
  redactionToken,
  SCRUBBER_ORDER,
  SCRUBBER_PATTERNS,
  type IScrubberPattern,
} from './scrubbers';

/** Bounds the cost of every pattern on every value; also what a value is cut to. */
export const MAX_VALUE_LENGTH = 2_048;
const ELLIPSIS = '…';

interface ICompiledRule {
  readonly name: string;
  readonly pattern: RegExp;
  readonly keep: IScrubberPattern['keep'];
}

/**
 * The second stage of ADR 0008: every value that passed the allowlist is cut to a bounded length
 * and run through the enabled scrubbers, then the configured `additionalPatterns`, in order.
 * Patterns were checked at config load (`patternRisk`), so none can backtrack catastrophically.
 */
export class Redactor {
  private readonly rules: readonly ICompiledRule[];

  constructor(config: IRedactionConfig) {
    const enabled = new Set(config.scrubbers);

    this.rules = [
      ...SCRUBBER_ORDER.filter((scrubber) => enabled.has(scrubber)).flatMap((scrubber) =>
        SCRUBBER_PATTERNS[scrubber].map((pattern) => ({
          name: scrubber,
          pattern: new RegExp(pattern.source, pattern.flags),
          keep: pattern.keep,
        })),
      ),
      ...config.additionalPatterns.map(({ name, pattern }) => ({
        name,
        pattern: new RegExp(pattern, 'g'),
        keep: undefined,
      })),
    ];
  }

  redact(value: string, tally: RedactionTally): RedactedText {
    let text = this.cap(value, tally);

    for (const rule of this.rules) {
      text = text.replace(rule.pattern, (match: string, ...rest: unknown[]) => {
        if (match === '') {
          return match;
        }
        tally.match(rule.name);
        const token = redactionToken(rule.name);
        // The capture groups come before the match offset; an unmatched group is undefined.
        const offset = rest.findIndex((part) => typeof part === 'number');
        const groups = rest.slice(0, offset).map((part) => (typeof part === 'string' ? part : ''));

        return rule.keep === undefined ? token : rule.keep(groups, token);
      });
    }
    return text as RedactedText;
  }

  /**
   * Cut at the last whitespace before the cap, so a token split by the cut is dropped rather than
   * kept in part where no pattern would recognise it.
   */
  private cap(value: string, tally: RedactionTally): string {
    if (value.length <= MAX_VALUE_LENGTH) {
      return value;
    }
    tally.truncated += 1;
    const head = value.slice(0, MAX_VALUE_LENGTH);
    const boundary = head.search(/\s\S*$/);

    return `${boundary === -1 ? '' : head.slice(0, boundary)}${ELLIPSIS}`;
  }
}
