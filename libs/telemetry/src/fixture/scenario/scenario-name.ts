/** A scenario name becomes a directory name, so it must not be able to reshape the path. */
export const SCENARIO_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export function isScenarioName(value: string): boolean {
  return SCENARIO_NAME_PATTERN.test(value);
}
