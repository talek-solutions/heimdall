/** `MANIFEST_`-prefixed so the CLI can group codes by string value without collisions. */
export enum ManifestErrorCode {
  /** `HEIMDALL_MANIFEST`, or the default `~/.heimdall/manifest.yaml`, does not exist. */
  ManifestFileNotFound = 'MANIFEST_FILE_NOT_FOUND',
  ManifestFileUnreadable = 'MANIFEST_FILE_UNREADABLE',
  /** Malformed YAML. */
  ManifestParseFailed = 'MANIFEST_PARSE_FAILED',
  /** An `apiVersion` no parser handles, or more than one `apiVersion` in the file. */
  ManifestUnsupportedVersion = 'MANIFEST_UNSUPPORTED_VERSION',
  /** A schema or cross-reference violation; the message names the resource and field. */
  ManifestInvalid = 'MANIFEST_INVALID',
}
