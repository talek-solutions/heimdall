import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ScenarioFile } from '../scenario/scenario.enums';
import { ScenarioLoader } from '../scenario/scenario.loader';
import type { IScenario } from '../scenario/scenario.model';

export type ScenarioSources = Partial<Record<ScenarioFile, string>>;

export const TEST_SCENARIO = 'test-scenario';

export const MINIMAL_MANIFEST = `
version: 1
seed: 7
duration: 2h
resolution: 15s
`;

const roots: string[] = [];

/** Specs compile to `dist`, which never holds YAML, so scenarios are written to a temp dir. */
export async function writeScenarios(scenarios: Readonly<Record<string, ScenarioSources>>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'heimdall-scenarios-'));
  roots.push(root);

  for (const [name, files] of Object.entries(scenarios)) {
    await mkdir(join(root, name));
    for (const [file, source] of Object.entries(files)) {
      await writeFile(join(root, name, file), source ?? '');
    }
  }
  return root;
}

export async function loadScenario(files: ScenarioSources): Promise<IScenario> {
  const root = await writeScenarios({
    [TEST_SCENARIO]: { [ScenarioFile.Manifest]: MINIMAL_MANIFEST, ...files },
  });
  return new ScenarioLoader().load(root, TEST_SCENARIO);
}

export async function removeScenarioRoots(): Promise<void> {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
}
