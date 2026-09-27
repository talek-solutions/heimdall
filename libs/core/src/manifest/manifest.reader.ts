import { readFile } from 'node:fs/promises';
import { Injectable } from '@nestjs/common';
import { parseAllDocuments } from 'yaml';
import { ManifestApiVersion, ManifestEnvVariable } from './enums';
import { ManifestError, ManifestErrorCode } from './errors';
import type { IManifestDocument } from './interfaces/manifest-document.interface';
import type { IManifestV1 } from './interfaces/v1';
import type { ManifestParser } from './parsers/manifest.parser';
import { ManifestV1Parser } from './parsers/v1/manifest-v1.parser';

const FILE_NOT_FOUND = 'ENOENT';

/** Reads the manifest file and hands its documents to the parser for their `apiVersion`. */
@Injectable()
export class ManifestReader {
  private readonly parsers: ReadonlyMap<ManifestApiVersion, ManifestParser<object, IManifestV1>>;

  constructor(v1: ManifestV1Parser) {
    this.parsers = new Map([[v1.version, v1]]);
  }

  async load(filePath: string): Promise<IManifestV1> {
    return this.parse(await this.read(filePath));
  }

  async parse(source: string): Promise<IManifestV1> {
    const documents = this.split(source);
    return this.parserFor(documents).parse(documents);
  }

  private split(source: string): IManifestDocument[] {
    // Merge keys (`<<: *base`) let a document reuse a label set or matcher block.
    const sections = parseAllDocuments(source, { merge: true });
    const syntaxErrors = sections.flatMap((section, index) =>
      section.errors.map((error) => `document ${index + 1}: ${error.message}`),
    );

    if (syntaxErrors.length > 0) {
      throw new ManifestError(ManifestErrorCode.ManifestParseFailed, syntaxErrors.join('; '));
    }
    const documents: IManifestDocument[] = [];
    const issues: string[] = [];

    for (const [index, section] of sections.entries()) {
      const content: unknown = section.toJS();
      const position = index + 1;

      // An empty section, e.g. after a trailing `---`.
      if (content === null || content === undefined) {
        continue;
      }
      if (typeof content !== 'object' || Array.isArray(content)) {
        issues.push(`document ${position}: must be a YAML mapping`);
        continue;
      }
      documents.push({ position, content: content as Readonly<Record<string, unknown>> });
    }

    if (issues.length > 0) {
      throw new ManifestError(ManifestErrorCode.ManifestInvalid, issues.join('; '));
    }
    if (documents.length === 0) {
      throw new ManifestError(ManifestErrorCode.ManifestInvalid, 'the manifest has no documents');
    }
    return documents;
  }

  // Checked before any schema so an unsupported version is reported plainly, not as a
  // pile of field errors from the wrong parser.
  private parserFor(documents: readonly IManifestDocument[]): ManifestParser<object, IManifestV1> {
    const missing = documents.filter(({ content }) => content['apiVersion'] === undefined);

    if (missing.length > 0) {
      throw new ManifestError(
        ManifestErrorCode.ManifestInvalid,
        missing.map(({ position }) => `document ${position}: apiVersion is required`).join('; '),
      );
    }
    const versions = [...new Set(documents.map(({ content }) => content['apiVersion']))];

    if (versions.length > 1) {
      throw new ManifestError(
        ManifestErrorCode.ManifestUnsupportedVersion,
        `a manifest uses a single apiVersion; found ${versions.map(String).join(', ')}`,
      );
    }
    const parser = this.parsers.get(versions[0] as ManifestApiVersion);

    if (parser === undefined) {
      throw new ManifestError(
        ManifestErrorCode.ManifestUnsupportedVersion,
        `apiVersion ${String(versions[0])} is not supported; expected one of ${[...this.parsers.keys()].join(', ')}`,
      );
    }
    return parser;
  }

  private async read(filePath: string): Promise<string> {
    try {
      return await readFile(filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === FILE_NOT_FOUND) {
        throw new ManifestError(
          ManifestErrorCode.ManifestFileNotFound,
          `no manifest at ${filePath}; create it, or point ${ManifestEnvVariable.ManifestPath} at one`,
          { cause: error },
        );
      }
      throw new ManifestError(
        ManifestErrorCode.ManifestFileUnreadable,
        `cannot read ${filePath}: ${(error as Error).message}`,
        { cause: error },
      );
    }
  }
}
