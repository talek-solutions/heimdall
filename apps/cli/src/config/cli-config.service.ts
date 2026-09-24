import { Inject, Injectable } from '@nestjs/common';
import { HEIMDALL_CONFIG, type IHeimdallConfig } from '@heimdall/config';
import { stdoutIsTty } from '../presentation/streams';
import type { CliConfig, CliFlags } from './cli-config.model';
import { resolveCliConfig } from './cli-config.resolver';

@Injectable()
export class CliConfigService {
  constructor(@Inject(HEIMDALL_CONFIG) private readonly config: IHeimdallConfig) {}

  resolve(flags: CliFlags): CliConfig {
    return resolveCliConfig({
      flags,
      env: process.env,
      file: this.config.defaults,
      isTty: stdoutIsTty(),
    });
  }
}
