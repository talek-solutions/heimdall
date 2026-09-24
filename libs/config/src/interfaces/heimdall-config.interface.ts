import type { LogLevel, OutputFormat } from '@heimdall/core';
import type { AuthScheme, Scrubber, SignalType, TelemetryBackend } from '@heimdall/telemetry';
import type { ConfigKind, ConfigVersion } from '../enums';

export interface IMetadataConfig {
  readonly description?: string | undefined;
  readonly labels: Readonly<Record<string, string>>;
  readonly annotations: Readonly<Record<string, string>>;
}

export type IAuthConfig =
  | { readonly scheme: AuthScheme.None }
  | { readonly scheme: AuthScheme.Bearer; readonly tokenEnv: string }
  | {
      readonly scheme: AuthScheme.Basic;
      readonly usernameEnv: string;
      readonly passwordEnv: string;
    };

interface ISourceConfigBase {
  readonly alias: string;
  readonly url: string;
  readonly auth: IAuthConfig;
  readonly timeoutMs: number;
  readonly metadata: IMetadataConfig;
}

export interface IDirectSourceConfig extends ISourceConfigBase {
  readonly type: TelemetryBackend.Loki | TelemetryBackend.Prometheus | TelemetryBackend.Tempo;
}

export interface IGrafanaSourceConfig extends ISourceConfigBase {
  readonly type: TelemetryBackend.Grafana;
  readonly datasourceUid: string;
  readonly signal: SignalType;
}

export type ISourceConfig = IDirectSourceConfig | IGrafanaSourceConfig;

export interface IContextConfig {
  readonly name: string;
  readonly sources: readonly string[];
  readonly metadata: IMetadataConfig;
}

export interface IRedactionConfig {
  readonly scrubbers: readonly Scrubber[];
  readonly additionalPatterns: readonly { readonly name: string; readonly pattern: string }[];
}

export interface IDefaultsConfig {
  readonly output?: OutputFormat | undefined;
  readonly logLevel?: LogLevel | undefined;
}

export interface IHeimdallConfig {
  readonly version: ConfigVersion;
  readonly kind: ConfigKind;
  readonly currentContext: string | null;
  readonly sources: readonly ISourceConfig[];
  readonly contexts: readonly IContextConfig[];
  readonly redaction: IRedactionConfig;
  readonly defaults: IDefaultsConfig;
}
