import type { LabelSemantic } from '../manifest/enums';
import type { IMetricDefinition, ISemanticSelector } from './interfaces';

/**
 * Label name → value for a selector written in label meanings, e.g. `{ route: '/orders' }`
 * becomes `{ http_route: '/orders' }`. `undefined` when the metric has no label for a meaning.
 */
export function labelMatchers(
  metric: IMetricDefinition,
  selector: ISemanticSelector,
): Readonly<Record<string, string>> | undefined {
  const labelOf = new Map(
    Object.entries(metric.labels).map(([label, meaning]) => [meaning, label] as const),
  );
  const matchers: Record<string, string> = {};

  for (const [meaning, value] of Object.entries(selector)) {
    const label = labelOf.get(meaning as LabelSemantic);

    if (label === undefined) {
      return undefined;
    }
    if (value !== undefined) {
      matchers[label] = value;
    }
  }
  return matchers;
}
