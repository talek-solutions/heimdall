import { Module } from '@nestjs/common';
import { manifestPathProvider } from './manifest.providers';
import { ManifestReader } from './manifest.reader';
import { HEIMDALL_MANIFEST_PATH } from './manifest.tokens';
import { ManifestV1Parser } from './parsers/v1/manifest-v1.parser';

// No eagerly loaded manifest: only commands that investigate need one, and a missing
// file must not fail every other command at bootstrap.
@Module({
  providers: [ManifestV1Parser, ManifestReader, manifestPathProvider],
  exports: [ManifestReader, HEIMDALL_MANIFEST_PATH],
})
export class ManifestModule {}
