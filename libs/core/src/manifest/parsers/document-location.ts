/** `document 3 (Component/services-2)`, or `document 3` when the document has no usable identity. */
export function documentLocation(position: number, kind: unknown, name: unknown): string {
  return typeof kind === 'string' && typeof name === 'string'
    ? `document ${position} (${kind}/${name})`
    : `document ${position}`;
}
