import type { IWireMatrixSeries, IWireVectorSample } from '../engine/metric-evaluator';
import { formatSampleValue } from '../engine/sample-format';

/** The aggregations the fixture evaluates around a whole query; everything else is routed. */
export enum BareAggregation {
  Sum = 'sum',
  Max = 'max',
}

const BARE_AGGREGATION_START = /^(sum|max)\s*\(/;
const STRING_LITERAL_AT = /"(?:[^"\\]|\\.)*"|`[^`]*`/y;

const REDUCERS: Readonly<Record<BareAggregation, (values: readonly number[]) => number>> = {
  [BareAggregation.Sum]: (values) => values.reduce((total, value) => total + value, 0),
  [BareAggregation.Max]: (values) => Math.max(...values),
};

/**
 * `sum(…)` or `max(…)` with no `by` or `without` around the whole query: routing returns a series
 * per matching candidate, while Prometheus returns one (ADR 0014, amendment).
 */
export function bareAggregation(query: string): BareAggregation | undefined {
  const trimmed = query.trim();
  const match = BARE_AGGREGATION_START.exec(trimmed);

  if (match === null || closingParen(trimmed, match[0].length - 1) !== trimmed.length - 1) {
    return undefined;
  }
  return match[1] === BareAggregation.Max ? BareAggregation.Max : BareAggregation.Sum;
}

/** Point by point, with every label dropped, as Prometheus's aggregation does. */
export function aggregateMatrix(
  aggregation: BareAggregation,
  series: readonly IWireMatrixSeries[],
): IWireMatrixSeries[] {
  const [first] = series;

  if (first === undefined) {
    return [];
  }
  return [
    {
      metric: {},
      values: first.values.map(([timestamp], index) => [
        timestamp,
        formatSampleValue(
          REDUCERS[aggregation](series.map((entry) => Number(entry.values[index]?.[1]))),
        ),
      ]),
    },
  ];
}

export function aggregateVector(
  aggregation: BareAggregation,
  samples: readonly IWireVectorSample[],
): IWireVectorSample[] {
  const [first] = samples;

  if (first === undefined) {
    return [];
  }
  return [
    {
      metric: {},
      value: [
        first.value[0],
        formatSampleValue(REDUCERS[aggregation](samples.map((sample) => Number(sample.value[1])))),
      ],
    },
  ];
}

/** Index of the parenthesis closing the one at `open`, skipping string literals. */
function closingParen(query: string, open: number): number | undefined {
  let depth = 0;

  for (let position = open; position < query.length; position += 1) {
    STRING_LITERAL_AT.lastIndex = position;
    const literal = STRING_LITERAL_AT.exec(query);

    if (literal !== null) {
      position += literal[0].length - 1;
      continue;
    }
    if (query[position] === '(') {
      depth += 1;
    } else if (query[position] === ')') {
      depth -= 1;
      if (depth === 0) {
        return position;
      }
    }
  }
  return undefined;
}
