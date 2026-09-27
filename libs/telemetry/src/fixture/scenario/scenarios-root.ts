import { dirname, join } from 'node:path';

const PACKAGE_MANIFEST = '@heimdall/telemetry/package.json';
const SCENARIOS_DIRNAME = 'scenarios';

/** Scenarios live beside `src`, outside what swc compiles; the package root finds them from `dist` too. */
export function defaultScenariosRoot(): string {
  return join(dirname(require.resolve(PACKAGE_MANIFEST)), SCENARIOS_DIRNAME);
}
