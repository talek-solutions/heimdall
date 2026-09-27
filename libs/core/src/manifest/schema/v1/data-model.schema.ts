import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsPositive, IsString } from 'class-validator';
import { DataModelKind } from '../../enums';
import type { IDataModelEntryV1 } from '../../interfaces/v1';
import { AtLeastOneOf } from './decorators/one-of.decorator';

@AtLeastOneOf(['name', 'key'])
export class DataModelEntrySchemaV1 implements IDataModelEntryV1 {
  @IsEnum(DataModelKind)
  kind!: DataModelKind;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  key?: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  partitions?: number;
}
