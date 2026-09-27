/** One `---` section of the manifest file, before any schema is applied. */
export interface IManifestDocument {
  /** 1-based, counting every section of the file, so it matches what the author sees. */
  readonly position: number;
  readonly content: Readonly<Record<string, unknown>>;
}
