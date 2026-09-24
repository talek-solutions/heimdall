import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { FieldSemantic, SignalType } from '@heimdall/telemetry';
import { IsRecord } from './is-record.decorator';

export class QueryConfig {
  @IsString()
  @IsNotEmpty()
  name!: string;

  /** Must match the `name` of a declared backend. */
  @IsString()
  @IsNotEmpty()
  backend!: string;

  @IsEnum(SignalType)
  signal!: SignalType;

  /**
   * The backend's OWN query language — LogQL, PromQL, TraceQL (ADR 0005).
   * Heimdall does not parse or rewrite this.
   */
  @IsString()
  @IsNotEmpty()
  query!: string;

  /**
   * What this query is for, in plain language. Not documentation: the model reads
   * this to decide which query to run, so a vague description degrades RCA quality
   * as surely as a wrong one.
   */
  @IsString()
  @IsNotEmpty()
  description!: string;

  /**
   * Backend field name -> what it means. Doubles as the egress allowlist: a field
   * absent from this map never leaves the adapter (ADR 0008).
   */
  @IsRecord({ values: Object.values(FieldSemantic) })
  fields!: Record<string, FieldSemantic>;
}
