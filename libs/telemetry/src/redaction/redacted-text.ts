declare const REDACTED: unique symbol;

/**
 * Text that passed the allowlist and every enabled scrubber. Only the `Redactor` makes one, so a
 * value of this type is the `TelemetryRecord` guarantee of ADR 0008 at field level.
 */
export type RedactedText = string & { readonly [REDACTED]: true };
