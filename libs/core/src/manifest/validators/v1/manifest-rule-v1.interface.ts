import type { IManifestIssue } from '../../interfaces/manifest-issue.interface';
import type { IManifestV1 } from '../../interfaces/v1';
import type { ManifestIndexV1 } from '../../parsers/v1/manifest-index-v1';

/** One semantic check. Runs only on an assembled manifest whose documents are well-formed. */
export interface IManifestRuleV1 {
  validate(manifest: IManifestV1, index: ManifestIndexV1): IManifestIssue[];
}
