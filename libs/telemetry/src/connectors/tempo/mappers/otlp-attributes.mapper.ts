import { isRecord } from '../../shared/guards';
import type { TempoAttributes, TempoAttributeValue } from '../api/tempo.response';

/** OTLP JSON `KeyValue[]` → a plain record. Malformed entries are skipped, not fatal. */
export function toAttributes(list: unknown): TempoAttributes {
  if (!Array.isArray(list)) {
    return {};
  }
  const attributes: Record<string, TempoAttributeValue> = {};

  for (const entry of list) {
    if (isRecord(entry) && typeof entry['key'] === 'string') {
      attributes[entry['key']] = toAttributeValue(entry['value']);
    }
  }
  return attributes;
}

// int64 arrives as a string in OTLP JSON; it is narrowed to a number here.
function toAttributeValue(value: unknown): TempoAttributeValue {
  if (!isRecord(value)) {
    return null;
  }
  if (typeof value['stringValue'] === 'string') {
    return value['stringValue'];
  }
  if (typeof value['boolValue'] === 'boolean') {
    return value['boolValue'];
  }
  if (value['intValue'] !== undefined) {
    return Number(value['intValue']);
  }
  if (typeof value['doubleValue'] === 'number') {
    return value['doubleValue'];
  }
  if (typeof value['bytesValue'] === 'string') {
    return value['bytesValue'];
  }
  if (isRecord(value['arrayValue'])) {
    const values = value['arrayValue']['values'];
    return Array.isArray(values) ? values.map(toAttributeValue) : [];
  }
  if (isRecord(value['kvlistValue'])) {
    return toAttributes(value['kvlistValue']['values']);
  }
  return null;
}
