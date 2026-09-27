import { Type } from 'class-transformer';
import { IsNotEmpty, IsString, ValidateNested } from 'class-validator';
import type {
  ILogsIdentityV1,
  IMetricsIdentityV1,
  ITelemetryIdentityV1,
  ITracesIdentityV1,
} from '../../interfaces/v1';
import { IsRecord } from './decorators/is-record.decorator';
import { FIELD_NAME, LABEL_NAME, SEMANTIC_NAME } from './identifiers';

export class LogsIdentitySchemaV1 implements ILogsIdentityV1 {
  @IsString()
  @IsNotEmpty()
  selector!: string;

  // Open meanings, not FieldSemantic: correlation keys such as `orderId` are the user's own.
  @IsRecord({ key: FIELD_NAME, value: SEMANTIC_NAME })
  fields: Record<string, string> = {};
}

export class MetricsIdentitySchemaV1 implements IMetricsIdentityV1 {
  @IsRecord({ key: LABEL_NAME })
  matchers!: Record<string, string>;
}

export class TracesIdentitySchemaV1 implements ITracesIdentityV1 {
  @IsString()
  @IsNotEmpty()
  serviceName!: string;
}

export class TelemetryIdentitySchemaV1 implements ITelemetryIdentityV1 {
  @ValidateNested()
  @Type(() => LogsIdentitySchemaV1)
  logs?: LogsIdentitySchemaV1;

  @ValidateNested()
  @Type(() => MetricsIdentitySchemaV1)
  metrics?: MetricsIdentitySchemaV1;

  @ValidateNested()
  @Type(() => TracesIdentitySchemaV1)
  traces?: TracesIdentitySchemaV1;
}
