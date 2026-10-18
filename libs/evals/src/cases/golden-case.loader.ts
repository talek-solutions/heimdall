import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { parse } from 'yaml';
import { ConclusionOutcome } from '@heimdall/investigation';
import { isRecordedVariable } from '@heimdall/transcript';
import type { IEvalsConfig } from '../config/evals-config.model';
import { EvalError, EvalErrorCode } from '../errors';
import { EVALS_CONFIG } from '../evals.tokens';
import type { IGoldenCase, IReferenceAnswer } from './golden-case.interface';

const CASE_FILE = /\.ya?ml$/;
type Fields = Record<string, unknown>;

/** Golden cases from `golden/*.yaml`, checked field by field so a typo names its file and field. */
@Injectable()
export class GoldenCaseLoader {
  constructor(@Inject(EVALS_CONFIG) private readonly config: IEvalsConfig) {}

  /** Every case, or the named ones, in file order. */
  load(names: readonly string[] = []): IGoldenCase[] {
    const cases = readdirSync(this.config.goldenDir)
      .filter((file) => CASE_FILE.test(file))
      .sort()
      .map((file) => parseCase(path.join(this.config.goldenDir, file)));
    const unknown = names.filter((name) => !cases.some((candidate) => candidate.name === name));

    if (unknown.length > 0) {
      throw new EvalError(
        EvalErrorCode.CaseNotFound,
        `no golden case is called ${unknown.join(', ')}; the cases are ${cases.map(({ name }) => name).join(', ')}`,
      );
    }
    return names.length === 0 ? cases : cases.filter(({ name }) => names.includes(name));
  }
}

export function parseCase(file: string): IGoldenCase {
  const fail = (problem: string): never => {
    throw new EvalError(EvalErrorCode.CaseInvalid, `${file}: ${problem}`);
  };
  let document: unknown;
  try {
    document = parse(readFileSync(file, 'utf8'));
  } catch (error) {
    return fail(`not YAML (${error instanceof Error ? error.message : String(error)})`);
  }
  const fields = record(document) ?? fail('must be a mapping');
  const text = (from: Fields, key: string, where = ''): string => {
    const value = from[key];
    return typeof value === 'string' && value.trim() !== ''
      ? value.trim()
      : fail(`${where}${key} must be a non-empty string`);
  };
  const optional = (from: Fields, key: string, where = ''): string | undefined =>
    from[key] === undefined ? undefined : text(from, key, where);
  const reference = record(fields['reference']) ?? fail('reference must be a mapping');
  const outcome = text(reference, 'outcome', 'reference.');
  const env = record(fields['env'] ?? {}) ?? fail('env must be a mapping');
  const evidence = reference['evidence'];

  if (!(Object.values(ConclusionOutcome) as string[]).includes(outcome)) {
    fail(`reference.outcome must be one of ${Object.values(ConclusionOutcome).join(', ')}`);
  }
  if (!Array.isArray(evidence) || !evidence.every((item) => typeof item === 'string')) {
    fail('reference.evidence must be a list of statements');
  }
  for (const [name, value] of Object.entries(env)) {
    if (!isRecordedVariable(name) || typeof value !== 'string') {
      fail(`env.${name} must be an INVESTIGATION_* or AGENT_* variable with a string value`);
    }
  }
  const answer: IReferenceAnswer = {
    outcome: outcome as ConclusionOutcome,
    origin: optional(reference, 'origin', 'reference.'),
    cause: optional(reference, 'cause', 'reference.'),
    mechanism: text(reference, 'mechanism', 'reference.'),
    evidence: evidence as string[],
  };

  return {
    name: text(fields, 'name'),
    description: text(fields, 'description'),
    manifest: path.resolve(path.dirname(file), text(fields, 'manifest')),
    scenario: text(fields, 'scenario'),
    anchor: text(fields, 'anchor'),
    query: text(fields, 'query'),
    since: text(fields, 'since'),
    entry: optional(fields, 'entry'),
    environment: optional(fields, 'environment'),
    env: env as Record<string, string>,
    reference: answer,
  };
}

function record(value: unknown): Fields | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Fields)
    : undefined;
}
