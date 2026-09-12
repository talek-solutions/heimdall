import { Command } from 'nest-commander';
import { Streams } from '../../presentation/streams';
import { HeimdallCommand } from '../heimdall.command';
import { version } from '../../version';

@Command({ name: 'version', description: 'Print the Heimdall version' })
export class VersionCommand extends HeimdallCommand {
  constructor(streams: Streams) {
    super(streams);
  }

  protected async execute(): Promise<void> {
    // Data, so stdout — scripts parse this. Deliberately no banner.
    this.streams.write(`${version}\n`);
  }
}
