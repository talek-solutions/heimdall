import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsPositive,
  IsString,
  IsUrl,
  Matches,
  Max,
  ValidateNested,
} from 'class-validator';
import { SignalType, TelemetryBackend } from '@heimdall/telemetry';
import { AUTH_SUBTYPES, AuthConfigBase, NoAuthConfig, type AuthConfig } from './auth.schema';
import { MetadataConfig, RESOURCE_NAME, RESOURCE_NAME_MESSAGE } from './metadata.schema';

const DIRECT_BACKENDS = [
  TelemetryBackend.Loki,
  TelemetryBackend.Prometheus,
  TelemetryBackend.Tempo,
] as const;

export class SourceConfigBase<T extends TelemetryBackend = TelemetryBackend> {
  @IsEnum(TelemetryBackend)
  type!: T;

  @Matches(RESOURCE_NAME, { message: RESOURCE_NAME_MESSAGE })
  alias!: string;

  @IsUrl({ require_tld: false, require_protocol: true })
  url!: string;

  @ValidateNested()
  @Type(() => AuthConfigBase, {
    discriminator: { property: 'scheme', subTypes: AUTH_SUBTYPES },
    keepDiscriminatorProperty: true,
  })
  auth: AuthConfig = new NoAuthConfig();

  @IsInt()
  @IsPositive()
  @Max(120_000)
  timeoutMs = 30_000;

  @ValidateNested()
  @Type(() => MetadataConfig)
  metadata: MetadataConfig = new MetadataConfig();
}

export class DirectSourceConfig extends SourceConfigBase<(typeof DIRECT_BACKENDS)[number]> {}

export class GrafanaSourceConfig extends SourceConfigBase<TelemetryBackend.Grafana> {
  @IsString()
  @IsNotEmpty()
  datasourceUid!: string;

  @IsEnum(SignalType)
  signal!: SignalType;
}

export type SourceConfig = DirectSourceConfig | GrafanaSourceConfig;

export const SOURCE_SUBTYPES = [
  ...DIRECT_BACKENDS.map((name) => ({ value: DirectSourceConfig, name })),
  { value: GrafanaSourceConfig, name: TelemetryBackend.Grafana },
];
