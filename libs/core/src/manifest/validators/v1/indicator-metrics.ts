import type { IIndicatorV1 } from '../../interfaces/v1';

/** `[field, metric reference]` for each metric an indicator reads, located for issues. */
export function indicatorMetrics(indicator: IIndicatorV1): (readonly [string, string])[] {
  if (indicator.ratio !== undefined) {
    return [
      ['ratio.numerator', indicator.ratio.numerator],
      ['ratio.denominator', indicator.ratio.denominator],
    ];
  }
  return indicator.metric === undefined ? [] : [['metric', indicator.metric]];
}
