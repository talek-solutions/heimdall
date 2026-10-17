import { registerDecorator, type ValidationOptions } from 'class-validator';
import { PATTERN_RISK_MESSAGES, patternRisk } from '../redaction/pattern-safety';

/** A scrubbing pattern that compiles and cannot backtrack catastrophically. */
export function IsSafePattern(options?: ValidationOptions): PropertyDecorator {
  return (target, propertyName) => {
    registerDecorator({
      name: 'isSafePattern',
      target: target.constructor,
      propertyName: propertyName as string,
      ...(options === undefined ? {} : { options }),
      validator: {
        validate(value: unknown): boolean {
          return typeof value === 'string' && patternRisk(value) === undefined;
        },
        defaultMessage(args): string {
          const risk = typeof args?.value === 'string' ? patternRisk(args.value) : undefined;
          return `$property ${risk === undefined ? 'must be a string' : PATTERN_RISK_MESSAGES[risk]}`;
        },
      },
    });
  };
}
