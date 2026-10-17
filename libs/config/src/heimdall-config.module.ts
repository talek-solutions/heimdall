import { Global, Module } from '@nestjs/common';
import { ConfigBootstrapper } from './config.bootstrapper';
import { ConfigLoader } from './config.loader';
import { ConfigV1Parser } from './parsers/v1/config-v1.parser';
import { heimdallConfigPathProvider, heimdallConfigProvider } from './config.providers';
import { HEIMDALL_CONFIG, HEIMDALL_CONFIG_PATH } from './config.tokens';

/** Global: loaded once by the application, read by any library that needs a live source. */
@Global()
@Module({
  providers: [
    ConfigV1Parser,
    ConfigLoader,
    ConfigBootstrapper,
    heimdallConfigPathProvider,
    heimdallConfigProvider,
  ],
  exports: [HEIMDALL_CONFIG_PATH, HEIMDALL_CONFIG],
})
export class HeimdallConfigModule {}
