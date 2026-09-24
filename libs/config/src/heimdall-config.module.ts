import { Module } from '@nestjs/common';
import { ConfigBootstrapper } from './config.bootstrapper';
import { ConfigLoader } from './config.loader';
import { ConfigV1Parser } from './parsers/v1/config-v1.parser';
import { heimdallConfigPathProvider, heimdallConfigProvider } from './config.providers';
import { HEIMDALL_CONFIG, HEIMDALL_CONFIG_PATH } from './config.tokens';

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
