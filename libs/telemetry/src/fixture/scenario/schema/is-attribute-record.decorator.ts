import { registerDecorator, type ValidationOptions } from 'class-validator';

/** OpenTelemetry attribute names, e.g. `http.response.status_code`. */
export const ATTRIBUTE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

/** A map of span attributes: scalar values only, as OTLP typed values carry them. */
export function IsAttributeRecord(options?: ValidationOptions): PropertyDecorator {
  return (target, propertyName) => {
    registerDecorator({
      name: 'isAttributeRecord',
      target: target.constructor,
      propertyName: propertyName as string,
      ...(options === undefined ? {} : { options }),
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'object' || value === null || Array.isArray(value)) {
            return false;
          }
          return Object.entries(value).every(
            ([name, entry]) =>
              ATTRIBUTE_NAME_PATTERN.test(name) &&
              (typeof entry === 'string' ||
                typeof entry === 'boolean' ||
                (typeof entry === 'number' && Number.isFinite(entry))),
          );
        },
        defaultMessage(): string {
          return `$property must map attribute names matching ${ATTRIBUTE_NAME_PATTERN} to strings, numbers or booleans`;
        },
      },
    });
  };
}
