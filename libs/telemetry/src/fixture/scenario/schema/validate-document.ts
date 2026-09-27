import { plainToInstance, type ClassConstructor } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';

export interface IValidatedDocument<T> {
  readonly value: T;
  /** `field.path: message`; empty when the document is valid. */
  readonly issues: readonly string[];
}

/** An empty file is an empty mapping; any other non-mapping is an issue. */
export async function validateDocument<T extends object>(
  schema: ClassConstructor<T>,
  document: unknown,
): Promise<IValidatedDocument<T>> {
  const plain = document ?? {};

  if (typeof plain !== 'object' || Array.isArray(plain)) {
    return { value: plainToInstance(schema, {}), issues: ['document must be a YAML mapping'] };
  }
  const value = plainToInstance(schema, plain, { exposeDefaultValues: true });
  const errors = await validate(value, {
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
  });
  return { value, issues: flatten(errors, '') };
}

function flatten(errors: readonly ValidationError[], parent: string): string[] {
  return errors.flatMap((error) => {
    const location = parent === '' ? error.property : `${parent}.${error.property}`;
    const own = Object.values(error.constraints ?? {}).map((message) => `${location}: ${message}`);
    return [...own, ...flatten(error.children ?? [], location)];
  });
}
