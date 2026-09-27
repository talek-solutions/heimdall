import { Injectable } from '@nestjs/common';
import { ManifestApiVersion } from '../../enums';
import type { IManifestV1 } from '../../interfaces/v1';
import { KIND_SCHEMAS_V1, type ManifestResourceSchemaV1 } from '../../schema/v1';
import { MANIFEST_RULES_V1 } from '../../validators/v1';
import { ManifestParser, type IParsedResource } from '../manifest.parser';
import { ManifestV1Assembler } from './manifest-v1.assembler';

@Injectable()
export class ManifestV1Parser extends ManifestParser<ManifestResourceSchemaV1, IManifestV1> {
  readonly version = ManifestApiVersion.V1;
  protected readonly schemas = KIND_SCHEMAS_V1;
  private readonly assembler = new ManifestV1Assembler();
  private readonly rules = MANIFEST_RULES_V1;

  protected build(resources: readonly IParsedResource<ManifestResourceSchemaV1>[]): IManifestV1 {
    const assembly = this.assembler.assemble(resources);

    if (!assembly.valid) {
      throw this.invalid(assembly.issues);
    }
    const issues = this.rules.flatMap((rule) => rule.validate(assembly.manifest, assembly.index));

    if (issues.length > 0) {
      throw this.invalid(issues);
    }
    return assembly.manifest;
  }
}
