import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  Matches,
  ValidateNested,
} from 'class-validator';
import { MemberRole, ReplicationMode, TopologyMode } from '../../enums';
import type { IMemberV1, ITopologyV1 } from '../../interfaces/v1';
import { RESOURCE_NAME, RESOURCE_NAME_MESSAGE } from './identifiers';
import { IndicatorSchemaV1 } from './indicator.schema';
import { TelemetryIdentitySchemaV1 } from './telemetry.schema';

export class MemberSchemaV1 implements IMemberV1 {
  @Matches(RESOURCE_NAME, { message: RESOURCE_NAME_MESSAGE })
  name!: string;

  @IsEnum(MemberRole)
  role!: MemberRole;

  @ValidateNested()
  @Type(() => TelemetryIdentitySchemaV1)
  telemetry: TelemetryIdentitySchemaV1 = new TelemetryIdentitySchemaV1();

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IndicatorSchemaV1)
  indicators: IndicatorSchemaV1[] = [];
}

export class TopologySchemaV1 implements ITopologyV1 {
  @IsEnum(TopologyMode)
  mode!: TopologyMode;

  @IsOptional()
  @IsEnum(ReplicationMode)
  replication?: ReplicationMode;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => MemberSchemaV1)
  members!: MemberSchemaV1[];
}
