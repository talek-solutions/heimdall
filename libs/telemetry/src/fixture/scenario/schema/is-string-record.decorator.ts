import { registerDecorator, type ValidationOptions } from 'class-validator';

/** class-validator cannot validate object keys; this covers label maps. */
export function IsStringRecord(key: RegExp, options?: ValidationOptions): PropertyDecorator {
  return (target, propertyName) => {
    registerDecorator({
      name: 'isStringRecord',
      target: target.constructor,
      propertyName: propertyName as string,
      ...(options === undefined ? {} : { options }),
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'object' || value === null || Array.isArray(value)) {
            return false;
          }
          return Object.entries(value).every(
            ([name, entry]) => key.test(name) && typeof entry === 'string',
          );
        },
        defaultMessage(): string {
          return `$property must be a map of strings with keys matching ${key}`;
        },
      },
    });
  };
}
