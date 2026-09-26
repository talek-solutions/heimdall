import type { TelemetryBackend } from '@heimdall/config';
import { TelemetryError, TelemetryErrorCode } from '../../errors';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

export function invalidResponse(backend: TelemetryBackend, detail: string): TelemetryError {
  return new TelemetryError(TelemetryErrorCode.InvalidResponse, `${backend} response ${detail}`);
}

export function toLabels(
  value: unknown,
  backend: TelemetryBackend,
): Readonly<Record<string, string>> {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value) || !Object.values(value).every((label) => typeof label === 'string')) {
    throw invalidResponse(backend, 'contains a malformed label set');
  }
  return value as Record<string, string>;
}
