import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { IsRecord } from './is-record.decorator';

export const RESOURCE_NAME = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
export const RESOURCE_NAME_MESSAGE =
  '$property must be lowercase letters, digits and dashes, starting and ending alphanumeric';

const LABEL_KEY = /^([a-z0-9]([-a-z0-9.]*[a-z0-9])?\/)?[A-Za-z0-9]([-A-Za-z0-9_.]*[A-Za-z0-9])?$/;

export class MetadataConfig {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  description?: string;

  @IsRecord({ key: LABEL_KEY })
  labels: Record<string, string> = {};

  @IsRecord()
  annotations: Record<string, string> = {};
}
