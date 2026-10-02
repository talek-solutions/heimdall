import { qualify } from '../manifest/parsers/v1/manifest-index-v1';
import { VertexType } from './enums';

const TYPE_SEPARATOR = ':';
const STEP_SEPARATOR = '#';
const INDICATOR_SEPARATOR = '@';

export function vertexId(type: VertexType, key: string): string {
  return `${type}${TYPE_SEPARATOR}${key}`;
}

/** The part after the type prefix: `services-2/orders-db` for a dependency. */
export function vertexKey(id: string): string {
  const separator = id.indexOf(TYPE_SEPARATOR);
  return separator === -1 ? id : id.slice(separator + 1);
}

export function vertexTypeOf(id: string): VertexType | undefined {
  const prefix = id.slice(0, id.indexOf(TYPE_SEPARATOR));
  return Object.values(VertexType).find((type) => type === prefix);
}

export const VertexIds = {
  functionality: (name: string): string => vertexId(VertexType.Functionality, name),
  flow: (name: string): string => vertexId(VertexType.Flow, name),
  step: (flow: string, position: number): string =>
    vertexId(VertexType.Step, `${flow}${STEP_SEPARATOR}${position}`),
  dependency: (component: string, name: string): string =>
    vertexId(VertexType.Dependency, qualify(component, name)),
  component: (name: string): string => vertexId(VertexType.Component, name),
  member: (component: string, name: string): string =>
    vertexId(VertexType.Member, qualify(component, name)),
  indicator: (subject: string, ordinal: number): string =>
    vertexId(VertexType.Indicator, `${subject}${INDICATOR_SEPARATOR}${ordinal}`),
} as const;
