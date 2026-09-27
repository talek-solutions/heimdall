import { IsArray, IsEnum, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';
import {
  Criticality,
  InteractionMode,
  ManifestProvenance,
  ReplicaRouting,
  Transport,
} from '../../enums';
import type { DependencyConfigValue, IDependencyV1 } from '../../interfaces/v1';
import { IsRecord } from './decorators/is-record.decorator';
import { FIELD_NAME, RESOURCE_NAME, RESOURCE_NAME_MESSAGE } from './identifiers';

export class DependencySchemaV1 implements IDependencyV1 {
  @Matches(RESOURCE_NAME, { message: RESOURCE_NAME_MESSAGE })
  name!: string;

  @Matches(RESOURCE_NAME, { message: RESOURCE_NAME_MESSAGE })
  target!: string;

  @IsEnum(Transport)
  transport!: Transport;

  @IsEnum(InteractionMode)
  mode!: InteractionMode;

  @IsEnum(Criticality)
  criticality!: Criticality;

  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  operations: string[] = [];

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  topic?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  consumerGroup?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  role?: string;

  @IsOptional()
  @IsEnum(ReplicaRouting)
  writeTo?: ReplicaRouting;

  @IsOptional()
  @IsEnum(ReplicaRouting)
  readFrom?: ReplicaRouting;

  @IsRecord({ key: FIELD_NAME, scalar: true })
  config: Record<string, DependencyConfigValue> = {};

  @IsEnum(ManifestProvenance)
  provenance: ManifestProvenance = ManifestProvenance.Declared;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  description?: string;
}
