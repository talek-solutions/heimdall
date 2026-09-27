import { Equals, IsEnum, Matches } from 'class-validator';
import { ManifestApiVersion, ManifestKind } from '../../enums';
import type { IResourceMetadataV1, ISystemScopedMetadataV1 } from '../../interfaces/v1';
import { IsRecord } from './decorators/is-record.decorator';
import { METADATA_LABEL_KEY, RESOURCE_NAME, RESOURCE_NAME_MESSAGE } from './identifiers';

export class ResourceMetadataSchemaV1 implements IResourceMetadataV1 {
  @Matches(RESOURCE_NAME, { message: RESOURCE_NAME_MESSAGE })
  name!: string;

  @IsRecord({ key: METADATA_LABEL_KEY })
  labels: Record<string, string> = {};

  @IsRecord()
  annotations: Record<string, string> = {};
}

export class SystemScopedMetadataSchemaV1
  extends ResourceMetadataSchemaV1
  implements ISystemScopedMetadataV1
{
  @Matches(RESOURCE_NAME, { message: RESOURCE_NAME_MESSAGE })
  system!: string;
}

export abstract class ResourceSchemaV1<K extends ManifestKind> {
  @Equals(ManifestApiVersion.V1)
  apiVersion!: ManifestApiVersion.V1;

  @IsEnum(ManifestKind)
  kind!: K;
}
