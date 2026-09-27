import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import type { ClassConstructor } from 'class-transformer';
import { parse as parseYaml, YAMLParseError } from 'yaml';
import { TelemetryError, TelemetryErrorCode } from '../../errors';
import { compileScenario, invalidScenario } from './scenario.compiler';
import { ScenarioFile } from './scenario.enums';
import type { IScenario } from './scenario.model';
import { isScenarioName, SCENARIO_NAME_PATTERN } from './scenario-name';
import { LogsFileSchema } from './schema/logs.schema';
import { MetricsFileSchema } from './schema/metrics.schema';
import { ScenarioManifestSchema } from './schema/scenario-manifest.schema';
import { TracesFileSchema } from './schema/traces.schema';
import { validateDocument } from './schema/validate-document';

const FILE_NOT_FOUND = 'ENOENT';
const HASH_ALGORITHM = 'sha256';

/** Reads `<root>/<name>/*.yaml`, validates every file and compiles the scenario. */
@Injectable()
export class ScenarioLoader {
  public async load(root: string, name: string): Promise<IScenario> {
    if (!isScenarioName(name)) {
      throw new TelemetryError(
        TelemetryErrorCode.InvalidDatasourceConfig,
        `scenario name '${name}' must match ${SCENARIO_NAME_PATTERN}`,
      );
    }
    const directory = join(root, name);
    const sources = new Map<ScenarioFile, string | undefined>([
      [ScenarioFile.Manifest, await this.readManifest(root, name)],
    ]);

    for (const file of [ScenarioFile.Metrics, ScenarioFile.Logs, ScenarioFile.Traces]) {
      sources.set(file, await this.readOptional(join(directory, file)));
    }
    const issues: string[] = [];
    const manifest = await this.validate(ScenarioManifestSchema, ScenarioFile.Manifest, sources, issues);
    const metrics = await this.validate(MetricsFileSchema, ScenarioFile.Metrics, sources, issues);
    const logs = await this.validate(LogsFileSchema, ScenarioFile.Logs, sources, issues);
    const traces = await this.validate(TracesFileSchema, ScenarioFile.Traces, sources, issues);

    if (issues.length > 0) {
      throw invalidScenario(name, issues);
    }
    return compileScenario({ name, contentHash: this.hash(sources), manifest, metrics, logs, traces });
  }

  private async readManifest(root: string, name: string): Promise<string> {
    try {
      return await readFile(join(root, name, ScenarioFile.Manifest), 'utf8');
    } catch (error) {
      const available = await this.available(root);
      throw new TelemetryError(
        TelemetryErrorCode.FixtureScenarioNotFound,
        `no fixture scenario named '${name}' (${ScenarioFile.Manifest} unreadable); available scenarios are ${available.length === 0 ? '(none)' : available.join(', ')}`,
        { cause: error },
      );
    }
  }

  private async readOptional(path: string): Promise<string | undefined> {
    try {
      return await readFile(path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === FILE_NOT_FOUND) {
        return undefined;
      }
      throw error;
    }
  }

  private async available(root: string): Promise<string[]> {
    try {
      const entries = await readdir(root, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
    } catch {
      return [];
    }
  }

  private async validate<T extends object>(
    schema: ClassConstructor<T>,
    file: ScenarioFile,
    sources: ReadonlyMap<ScenarioFile, string | undefined>,
    issues: string[],
  ): Promise<T> {
    let document: unknown;

    try {
      // Merge keys (`<<: *base`) let a file reuse a curve or label set.
      document = parseYaml(sources.get(file) ?? '', { merge: true });
    } catch (error) {
      const detail = error instanceof YAMLParseError ? error.message : String(error);
      issues.push(`${file}: ${detail}`);
      document = {};
    }
    const result = await validateDocument(schema, document);
    issues.push(...result.issues.map((issue) => `${file}: ${issue}`));
    return result.value;
  }

  private hash(sources: ReadonlyMap<ScenarioFile, string | undefined>): string {
    const hash = createHash(HASH_ALGORITHM);

    for (const [file, source] of sources) {
      hash.update(`${file}\0${source ?? ''}\0`);
    }
    return hash.digest('hex');
  }
}
