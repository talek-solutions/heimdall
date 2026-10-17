import { createHash } from 'node:crypto';
import { MAX_TEMPLATE_LENGTH, MIN_LITERAL_LENGTH } from './evidence.rules';

export const VARIABLE_TOKEN = '<*>';
const REDACTED_TOKEN = /\[REDACTED:[\w-]+\]/;
/** A digit anywhere, or a long run of id-like characters (hex, base64, UUID without digits). */
const VARIABLE = /\d|^[A-Za-z0-9+/=_-]{16,}$/;

/**
 * A message with its variable parts masked: split on whitespace, every token holding a digit or
 * looking like an id becomes `<*>`, and runs of them collapse. A redaction token stays as written.
 */
export function logTemplate(message: string): string {
  const tokens = message
    .split(/\s+/)
    .filter((token) => token !== '')
    .map((token) => (!REDACTED_TOKEN.test(token) && VARIABLE.test(token) ? VARIABLE_TOKEN : token))
    .filter((token, index, all) => token !== VARIABLE_TOKEN || all[index - 1] !== VARIABLE_TOKEN);
  const template = tokens.join(' ');

  return template.length <= MAX_TEMPLATE_LENGTH
    ? template
    : `${template.slice(0, MAX_TEMPLATE_LENGTH)}…`;
}

/** Stable across runs, so a replay or a later run can name the same template. */
export function templateId(template: string): string {
  return createHash('sha256').update(template).digest('hex').slice(0, 8);
}

/**
 * The longest run of literal tokens, to ask the baseline whether a template is really new; none
 * when it is shorter than 8 characters (too common to mean anything as a line filter).
 */
export function templateLiteral(template: string): string | undefined {
  const runs: string[][] = [[]];

  for (const token of template.replace(/…$/, '').split(' ')) {
    if (token === VARIABLE_TOKEN || REDACTED_TOKEN.test(token)) {
      runs.push([]);
    } else {
      runs.at(-1)?.push(token);
    }
  }
  const longest = runs
    .map((run) => run.join(' '))
    .reduce((best, run) => (run.length > best.length ? run : best), '');

  return longest.length >= MIN_LITERAL_LENGTH ? longest : undefined;
}
