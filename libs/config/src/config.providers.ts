import type { Provider } from '@nestjs/common';
import { ConfigBootstrapper } from './config.bootstrapper';
import { ConfigLoader } from './config.loader';
import { defaultConfigPath, resolveConfigPath } from './config.paths';
import { HEIMDALL_CONFIG, HEIMDALL_CONFIG_PATH } from './config.tokens';
import type { IHeimdallConfig } from './interfaces/heimdall-config.interface';

export const heimdallConfigPathProvider: Provider<string> = {
  provide: HEIMDALL_CONFIG_PATH,
  useFactory: (): string => resolveConfigPath(process.env),
};

// Only the default location is created; a missing HEIMDALL_CONFIG path is reported.
export const heimdallConfigProvider: Provider<IHeimdallConfig> = {
  provide: HEIMDALL_CONFIG,
  inject: [HEIMDALL_CONFIG_PATH, ConfigLoader, ConfigBootstrapper],
  useFactory: async (
    configPath: string,
    loader: ConfigLoader,
    bootstrapper: ConfigBootstrapper,
  ): Promise<IHeimdallConfig> => {
    if (configPath === defaultConfigPath()) {
      await bootstrapper.ensureDefault(configPath);
    }
    return loader.load(configPath);
  },
};
