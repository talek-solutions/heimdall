import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020';
import { parse } from 'yaml';

/** The `$id` of each published schema (ADR 0021). An id never changes and is never reused. */
export enum PublishedSchema {
  Transcript = 'urn:heimdall:schema:transcript:v1',
  Report = 'urn:heimdall:schema:report:v1',
  Scorecard = 'urn:heimdall:schema:scorecard:v1',
  ScoringSheet = 'urn:heimdall:schema:scoring-sheet:v1',
}

/** Where each schema lives: next to the code that writes its file (ADR 0019). */
export const SCHEMA_FILES: Readonly<Record<PublishedSchema, string>> = {
  [PublishedSchema.Transcript]: join('libs', 'transcript', 'schema', 'transcript.v1.schema.json'),
  [PublishedSchema.Report]: join('libs', 'investigation', 'schema', 'report.v1.schema.json'),
  [PublishedSchema.Scorecard]: join('libs', 'evals', 'schema', 'scorecard.v1.schema.json'),
  [PublishedSchema.ScoringSheet]: join('libs', 'evals', 'schema', 'scoring-sheet.v1.schema.json'),
};

export const TRANSCRIPT_FIXTURES = join('libs', 'transcript', 'schema', '__fixtures__');
export const EVAL_FIXTURES = join('libs', 'evals', 'schema', '__fixtures__');
export const CI_TRANSCRIPTS = join('libs', 'investigation', 'src', '__fixtures__', 'transcripts');

const SCORECARD_FILE = 'scorecard.json';
const SHEET_FILE = /\.score\.ya?ml$/;
const JSON_FILE = /\.json$/;

export interface IValidation {
  readonly valid: boolean;
  /** The JSON pointer of the first failure, and what it says. */
  readonly path?: string;
  readonly message?: string;
}

export interface IInvalidFile extends IValidation {
  readonly file: string;
}

/** The repository root, from wherever the spec runs. */
export function repoRoot(): string {
  const marker = SCHEMA_FILES[PublishedSchema.Transcript];
  let directory = __dirname;

  while (!existsSync(join(directory, marker))) {
    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error(`${marker} not found above ${__dirname}`);
    }
    directory = parent;
  }
  return directory;
}

export function readSchema(schema: PublishedSchema): Record<string, unknown> {
  return JSON.parse(readFileSync(join(repoRoot(), SCHEMA_FILES[schema]), 'utf8')) as Record<
    string,
    unknown
  >;
}

/** A file as a reader gets it: JSON as written (no `$number` decoding), or a sheet's YAML. */
export function readDocument(file: string): unknown {
  const text = readFileSync(file, 'utf8');

  return SHEET_FILE.test(file) ? parse(text) : JSON.parse(text);
}

/**
 * The published schemas as a reader uses them: all registered, then looked up by `$id`. A schema
 * refers to another only by id (ADR 0021), so one loaded alone does not compile.
 */
export class SchemaSet {
  private readonly ajv = new Ajv2020({ allowUnionTypes: true });

  constructor(schemas: readonly PublishedSchema[] = Object.values(PublishedSchema)) {
    for (const schema of schemas) {
      this.ajv.addSchema(readSchema(schema));
    }
  }

  validate(schema: PublishedSchema, value: unknown): IValidation {
    const validator = this.compile(schema);

    if (validator(value)) {
      return { valid: true };
    }
    const first = validator.errors?.[0];

    return { valid: false, path: first?.instancePath ?? '', message: first?.message ?? '' };
  }

  /** Throws when a `$ref` names a schema that is not registered. */
  compile(schema: PublishedSchema): ValidateFunction {
    const validator = this.ajv.getSchema(schema);

    if (validator === undefined) {
      throw new Error(`${schema} is not registered`);
    }
    return validator;
  }

  /**
   * Every transcript, scorecard and scoring sheet under a Heimdall home (`runs/`, `evals/`), or
   * under any directory laid out the same way. Reads only; returns the files that do not validate.
   */
  validateHome(home: string): { readonly checked: number; readonly invalid: IInvalidFile[] } {
    const files: Array<readonly [PublishedSchema, string]> = [
      ...jsonIn(join(home, 'runs')).map((file) => [PublishedSchema.Transcript, file] as const),
    ];

    for (const session of directoriesIn(join(home, 'evals'))) {
      if (existsSync(join(session, SCORECARD_FILE))) {
        files.push([PublishedSchema.Scorecard, join(session, SCORECARD_FILE)]);
      }
      for (const sheet of filesIn(join(session, 'sheets')).filter((file) => SHEET_FILE.test(file))) {
        files.push([PublishedSchema.ScoringSheet, sheet]);
      }
      for (const run of directoriesIn(join(session, 'runs'))) {
        files.push(...jsonIn(run).map((file) => [PublishedSchema.Transcript, file] as const));
      }
    }
    const invalid = files
      .map(([schema, file]) => ({ file, ...this.validate(schema, readDocument(file)) }))
      .filter((outcome) => !outcome.valid);

    return { checked: files.length, invalid };
  }
}

function filesIn(directory: string): string[] {
  return existsSync(directory)
    ? readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => join(directory, entry.name))
        .sort()
    : [];
}

function directoriesIn(directory: string): string[] {
  return existsSync(directory)
    ? readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(directory, entry.name))
        .sort()
    : [];
}

function jsonIn(directory: string): string[] {
  return filesIn(directory).filter((file) => JSON_FILE.test(file));
}
