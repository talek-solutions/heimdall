/** ADR 0002's mutation flag: a mutating tool runs only behind a confirmation hook. */
export enum ToolAccess {
  ReadOnly = 'read-only',
  Mutating = 'mutating',
}
