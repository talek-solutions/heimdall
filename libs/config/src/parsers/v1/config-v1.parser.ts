import { Injectable } from '@nestjs/common';
import { ConfigVersion } from '../../enums';
import type { IHeimdallConfig } from '../../interfaces/heimdall-config.interface';
import { HeimdallConfig } from '../../schema';
import { ConfigParser } from '../config.parser';

@Injectable()
export class ConfigV1Parser extends ConfigParser {
  readonly version = ConfigVersion.V1;
  protected readonly schema = HeimdallConfig;

  protected override validateReferences(config: IHeimdallConfig): string[] {
    const issues: string[] = [];
    const aliases = new Set(config.sources.map((source) => source.alias));
    const contextNames = new Set(config.contexts.map((context) => context.name));

    for (const duplicate of this.findDuplicates(config.sources.map((source) => source.alias))) {
      issues.push(`sources: duplicate source alias '${duplicate}'`);
    }
    for (const duplicate of this.findDuplicates(config.contexts.map((context) => context.name))) {
      issues.push(`contexts: duplicate context name '${duplicate}'`);
    }

    config.contexts.forEach((context, contextIndex) => {
      for (const duplicate of this.findDuplicates(context.sources)) {
        issues.push(
          `contexts.${contextIndex}.sources: source '${duplicate}' is listed more than once`,
        );
      }
      context.sources.forEach((alias, sourceIndex) => {
        if (!aliases.has(alias)) {
          issues.push(
            `contexts.${contextIndex}.sources.${sourceIndex}: unknown source '${alias}'; declared sources are ${this.list(aliases)}`,
          );
        }
      });
    });

    if (config.currentContext !== null && !contextNames.has(config.currentContext)) {
      issues.push(
        `currentContext: unknown context '${config.currentContext}'; declared contexts are ${this.list(contextNames)}`,
      );
    }
    return issues;
  }

  private findDuplicates(names: readonly string[]): readonly string[] {
    const seen = new Set<string>();
    const duplicated = new Set<string>();

    for (const name of names) {
      if (seen.has(name)) {
        duplicated.add(name);
      }
      seen.add(name);
    }
    return [...duplicated];
  }

  private list(names: ReadonlySet<string>): string {
    return names.size === 0 ? '(none)' : [...names].join(', ');
  }
}
