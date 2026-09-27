import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { Transport } from '../../enums';
import type { IExposedInterfaceV1 } from '../../interfaces/v1';

export class ExposedInterfaceSchemaV1 implements IExposedInterfaceV1 {
  @IsEnum(Transport)
  transport!: Transport;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  spec?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  route?: string;
}
