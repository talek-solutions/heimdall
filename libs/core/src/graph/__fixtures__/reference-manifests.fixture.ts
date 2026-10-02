import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createReader } from '../../manifest/__fixtures__/manifest-v1.fixture';
import type { IManifestV1 } from '../../manifest/interfaces/v1';
import { SystemGraphCompiler } from '../compiler/system-graph.compiler';
import type { SystemGraph } from '../system-graph';

export enum ReferenceManifest {
  /** ADR 0015's worked example. */
  Shop = 'shop',
  /** Shaped after the telemetry fixture scenarios. */
  Checkout = 'checkout',
}

/** Specs run from `dist`, so walk up to the repository. */
export function referenceManifestPath(name: ReferenceManifest): string {
  const relative = join('.docs', 'manifests', name, 'manifest.yaml');
  let directory = __dirname;

  while (!existsSync(join(directory, relative))) {
    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error(`${relative} not found above ${__dirname}`);
    }
    directory = parent;
  }
  return join(directory, relative);
}

export async function loadReferenceManifest(name: ReferenceManifest): Promise<IManifestV1> {
  return createReader().parse(readFileSync(referenceManifestPath(name), 'utf8'));
}

export async function compileReferenceManifest(name: ReferenceManifest): Promise<SystemGraph> {
  return new SystemGraphCompiler().compile(await loadReferenceManifest(name));
}
