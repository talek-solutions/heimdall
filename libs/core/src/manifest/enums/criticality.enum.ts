export enum Criticality {
  /** The caller cannot serve its purpose without the dependency. */
  Hard = 'hard',
  /** The caller degrades but keeps working, e.g. a cache-aside read. */
  Soft = 'soft',
}
