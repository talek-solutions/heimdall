import type { DataModelKind } from '../../enums';

/** At least one of `name` or `key` is set. */
export interface IDataModelEntryV1 {
  readonly kind: DataModelKind;
  readonly name?: string | undefined;
  /** A topic's partition key, or a key pattern such as `order:{id}:status`. */
  readonly key?: string | undefined;
  readonly partitions?: number | undefined;
}
