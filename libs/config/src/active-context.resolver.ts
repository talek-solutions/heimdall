import { ConfigEnvVariable } from './enums';
import { ConfigError, ConfigErrorCode } from './errors';
import type {
  IHeimdallConfig,
  IMetadataConfig,
  ISourceConfig,
} from './interfaces/heimdall-config.interface';

export interface ActiveContext {
  readonly name: string;
  readonly metadata: IMetadataConfig;
  readonly sources: readonly ISourceConfig[];
}

export interface ActiveContextSelector {
  readonly flag?: string | undefined;
  readonly env: NodeJS.ProcessEnv;
}

/** flag > HEIMDALL_CONTEXT > currentContext. `undefined` when none is selected. */
export function resolveActiveContext(
  config: IHeimdallConfig,
  selector: ActiveContextSelector,
): ActiveContext | undefined {
  const name =
    nonEmpty(selector.flag) ??
    nonEmpty(selector.env[ConfigEnvVariable.Context]) ??
    config.currentContext;

  if (name === null) {
    return undefined;
  }

  const context = config.contexts.find((candidate) => candidate.name === name);

  if (context === undefined) {
    const declared = config.contexts.map((candidate) => candidate.name);
    throw new ConfigError(
      ConfigErrorCode.ConfigContextNotFound,
      `no context named '${name}'; declared contexts are ${declared.length === 0 ? '(none)' : declared.join(', ')}`,
    );
  }

  // The schema guarantees every alias resolves; the filter only narrows the type.
  const sources = context.sources
    .map((alias) => config.sources.find((source) => source.alias === alias))
    .filter((source): source is ISourceConfig => source !== undefined);

  return { name: context.name, metadata: context.metadata, sources };
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value === '' ? undefined : value;
}
