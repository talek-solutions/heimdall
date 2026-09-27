export interface IManifestIssue {
  /** Where the problem is, e.g. `Component/services-2 spec.dependsOn.1.target`. */
  readonly location: string;
  readonly message: string;
}
