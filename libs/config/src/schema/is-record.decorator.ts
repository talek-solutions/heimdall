import { registerDecorator, type ValidationOptions } from 'class-validator';

export interface RecordRules {
  readonly key?: RegExp;
  readonly values?: readonly string[];
}

/** class-validator cannot validate object keys; this covers string-keyed maps. */
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
            ([key, entry]) =>
              (rules.key === undefined || rules.key.test(key)) &&
              typeof entry === 'string' &&
              (rules.values === undefined || rules.values.includes(entry)),
          );
        },
        defaultMessage(): string {
          const values =
            rules.values === undefined ? 'strings' : `one of ${rules.values.join(', ')}`;
          const keys = rules.key === undefined ? '' : ` with keys matching ${rules.key}`;
          return `$property must be a map of ${values}${keys}`;
        },
      },
    });
  };
}
