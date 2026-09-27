import { registerDecorator } from 'class-validator';

/**
 * Class decorators for "one of these properties" rules. class-validator only validates
 * properties, and an optional property's validators are skipped when it is absent, so
 * the rule is registered under the joined keys (`metric|ratio`), which also names both
 * in the reported location. That joined key is whitelisted as a side effect, so a
 * document that literally sets it is rejected here.
 */
export function ExactlyOneOf(keys: readonly string[]): ClassDecorator {
  return oneOf('exactlyOneOf', keys, (count) => count === 1, 'exactly one of');
}

export function AtLeastOneOf(keys: readonly string[]): ClassDecorator {
  return oneOf('atLeastOneOf', keys, (count) => count >= 1, 'at least one of');
}

function oneOf(
  name: string,
  keys: readonly string[],
  accepts: (count: number) => boolean,
  quantity: string,
): ClassDecorator {
  return (target) => {
    registerDecorator({
      name,
      target,
      propertyName: keys.join('|'),
      validator: {
        validate(value: unknown, args): boolean {
          const object = args?.object as Readonly<Record<string, unknown>>;
          const set = keys.filter((key) => object[key] !== undefined && object[key] !== null);
          return value === undefined && accepts(set.length);
        },
        defaultMessage(args): string {
          return args?.value === undefined
            ? `${quantity} ${keys.join(', ')} must be set`
            : `property ${args.property} should not exist`;
        },
      },
    });
  };
}
