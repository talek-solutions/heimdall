import { registerDecorator, type ValidationOptions } from 'class-validator';

export interface RecordRules {
  readonly key?: RegExp | readonly string[];
  /** Applies to string values. */
  readonly value?: RegExp | readonly string[];
  /** Also accept finite numbers and booleans. */
  readonly scalar?: boolean;
}

/** class-validator cannot validate object keys; this covers string- and scalar-valued maps. */
export function IsRecord(rules: RecordRules = {}, options?: ValidationOptions): PropertyDecorator {
  return (target, propertyName) => {
    registerDecorator({
      name: 'isRecord',
      target: target.constructor,
      propertyName: propertyName as string,
      ...(options === undefined ? {} : { options }),
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'object' || value === null || Array.isArray(value)) {
            return false;
          }
          return Object.entries(value).every(
            ([key, entry]) => accepts(rules.key, key) && acceptsValue(rules, entry),
          );
        },
        defaultMessage(): string {
          const values = describe(rules.value, rules.scalar === true ? 'scalars' : 'strings');
          const keys = rules.key === undefined ? '' : ` with keys ${describe(rules.key, '')}`;
          return `$property must be a map of ${values}${keys}`;
        },
      },
    });
  };
}

function acceptsValue(rules: RecordRules, entry: unknown): boolean {
  if (typeof entry === 'string') {
    return accepts(rules.value, entry);
  }
  return (
    rules.scalar === true &&
    (typeof entry === 'boolean' || (typeof entry === 'number' && Number.isFinite(entry)))
  );
}

function accepts(rule: RegExp | readonly string[] | undefined, text: string): boolean {
  if (rule === undefined) {
    return true;
  }
  return rule instanceof RegExp ? rule.test(text) : rule.includes(text);
}

function describe(rule: RegExp | readonly string[] | undefined, fallback: string): string {
  if (rule === undefined) {
    return fallback;
  }
  return rule instanceof RegExp ? `matching ${rule}` : `one of ${rule.join(', ')}`;
}
