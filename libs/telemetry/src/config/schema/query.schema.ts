import { z } from 'zod';
import { FieldSemantic, SignalType } from '../../domain/enums';

export const querySchema = z.object({
  name: z.string().min(1),
  /** Must match the `name` of a declared backend; enforced by the root schema. */
  backend: z.string().min(1),
  signal: z.enum(SignalType),
  /**
   * The backend's OWN query language — LogQL, PromQL, TraceQL (ADR 0005).
   * Heimdall does not parse or rewrite this.
   */
  query: z.string().min(1),
  /**
   * What this query is for, in plain language. Not documentation: the model reads
   * this to decide which query to run, so a vague description degrades RCA quality
   * as surely as a wrong one.
   */
  description: z.string().min(1),
  /**
   * Backend field name -> what it means. Doubles as the egress allowlist: a field
   * absent from this map never leaves the adapter (ADR 0008).
   */
  fields: z.record(z.string().min(1), z.enum(FieldSemantic)),
});

export type QueryConfig = z.infer<typeof querySchema>;
