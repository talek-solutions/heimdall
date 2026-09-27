import 'reflect-metadata';
import type { ClassConstructor } from 'class-transformer';
import { ManifestKind } from '../../enums';
import { ComponentSchemaV1 } from './component.schema';
import { FlowSchemaV1 } from './flow.schema';
import { FunctionalitySchemaV1 } from './functionality.schema';
import { SystemSchemaV1 } from './system.schema';

export type ManifestResourceSchemaV1 =
  SystemSchemaV1 | ComponentSchemaV1 | FunctionalitySchemaV1 | FlowSchemaV1;

export const KIND_SCHEMAS_V1: ReadonlyMap<
  ManifestKind,
  ClassConstructor<ManifestResourceSchemaV1>
> = new Map<ManifestKind, ClassConstructor<ManifestResourceSchemaV1>>([
  [ManifestKind.System, SystemSchemaV1],
  [ManifestKind.Component, ComponentSchemaV1],
  [ManifestKind.Functionality, FunctionalitySchemaV1],
  [ManifestKind.Flow, FlowSchemaV1],
]);

export { REFERENCE_SEPARATOR } from './identifiers';
