import type { IManifestIssue } from '../../interfaces/manifest-issue.interface';
import type { IManifestResourceV1 } from '../../interfaces/v1';

/** `Component/services-2 spec.dependsOn.1.target`. */
export function issueAt(
  resource: IManifestResourceV1,
  path: string,
  message: string,
): IManifestIssue {
  return { location: `${resource.kind}/${resource.metadata.name} ${path}`, message };
}

export function listNames(names: readonly string[]): string {
  return names.length === 0 ? '(none)' : names.join(', ');
}
