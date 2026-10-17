import { Scrubber } from '@heimdall/config';

/** One pattern of a scrubber. `keep` rebuilds the parts worth keeping around the token. */
export interface IScrubberPattern {
  readonly source: string;
  readonly flags: string;
  readonly keep?: (groups: readonly string[], token: string) => string;
}

/**
 * Larger structures first, so a token inside them is not half-replaced by a smaller scrubber:
 * a PEM block before anything, a DSN's password before the email shape its userinfo resembles,
 * a bearer header before the JWT it usually carries.
 */
export const SCRUBBER_ORDER: readonly Scrubber[] = [
  Scrubber.PrivateKey,
  Scrubber.ConnectionString,
  Scrubber.BearerToken,
  Scrubber.Jwt,
  Scrubber.AwsAccessKey,
  Scrubber.Email,
];

/** The built-in patterns; `.docs/design/redaction-and-scrubbers.md` lists what each misses. */
export const SCRUBBER_PATTERNS: Readonly<Record<Scrubber, readonly IScrubberPattern[]>> = {
  [Scrubber.PrivateKey]: [
    {
      // An unterminated block (a cut value) is redacted to the end.
      source:
        '-----BEGIN [A-Z ]{0,40}PRIVATE KEY-----[\\s\\S]*?(?:-----END [A-Z ]{0,40}PRIVATE KEY-----|$)',
      flags: 'g',
    },
  ],
  [Scrubber.ConnectionString]: [
    {
      source: '\\b([a-zA-Z][a-zA-Z0-9+.-]{1,20}://)[^\\s:@/]+:[^\\s@/]+@',
      flags: 'g',
      keep: ([scheme], token) => `${scheme}${token}@`,
    },
    {
      source: '\\b(password|passwd|pwd)("?\\s*[=:]\\s*)("[^"]*"|\'[^\']*\'|[^\\s;,&"\']+)',
      flags: 'gi',
      keep: ([key, separator], token) => `${key}${separator}${token}`,
    },
  ],
  [Scrubber.BearerToken]: [
    {
      source: '\\b(bearer)\\s+[A-Za-z0-9._~+/=-]{8,}',
      flags: 'gi',
      keep: ([scheme], token) => `${scheme} ${token}`,
    },
  ],
  [Scrubber.Jwt]: [
    { source: '\\beyJ[A-Za-z0-9_-]{5,}\\.[A-Za-z0-9_-]{5,}\\.[A-Za-z0-9_-]*', flags: 'g' },
  ],
  [Scrubber.AwsAccessKey]: [{ source: '\\b(?:AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}\\b', flags: 'g' }],
  [Scrubber.Email]: [
    { source: '\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}\\b', flags: 'g' },
  ],
};

export function redactionToken(scrubber: string): string {
  return `[REDACTED:${scrubber}]`;
}
