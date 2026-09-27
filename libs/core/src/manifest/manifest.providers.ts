import type { Provider } from '@nestjs/common';
import { resolveManifestPath } from './manifest.paths';
import { HEIMDALL_MANIFEST_PATH } from './manifest.tokens';

export const manifestPathProvider: Provider<string> = {
  provide: HEIMDALL_MANIFEST_PATH,
  useFactory: (): string => resolveManifestPath(process.env),
};
