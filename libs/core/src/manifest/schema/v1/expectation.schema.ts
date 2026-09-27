import { IsEnum, IsNumber, IsOptional, IsPositive } from 'class-validator';
import { ExpectationKind } from '../../enums';
import type {
  IBaselineExpectationV1,
  INonZeroExpectationV1,
  ISloExpectationV1,
  IThresholdExpectationV1,
} from '../../interfaces/v1';
import { AtLeastOneOf } from './decorators/one-of.decorator';

const FINITE = { allowNaN: false, allowInfinity: false } as const;

export class ExpectationSchemaV1<K extends ExpectationKind = ExpectationKind> {
  @IsEnum(ExpectationKind)
  kind!: K;
}

export class BaselineExpectationSchemaV1
  extends ExpectationSchemaV1<ExpectationKind.Baseline>
  implements IBaselineExpectationV1
{
  override kind = ExpectationKind.Baseline as const;
}

@AtLeastOneOf(['min', 'max', 'p50', 'p90', 'p95', 'p99'])
export class SloExpectationSchemaV1
  extends ExpectationSchemaV1<ExpectationKind.Slo>
  implements ISloExpectationV1
{
  @IsOptional()
  @IsNumber(FINITE)
  min?: number;

  @IsOptional()
  @IsNumber(FINITE)
  max?: number;

  @IsOptional()
  @IsNumber(FINITE)
  @IsPositive()
  p50?: number;

  @IsOptional()
  @IsNumber(FINITE)
  @IsPositive()
  p90?: number;

  @IsOptional()
  @IsNumber(FINITE)
  @IsPositive()
  p95?: number;

  @IsOptional()
  @IsNumber(FINITE)
  @IsPositive()
  p99?: number;
}

@AtLeastOneOf(['min', 'max'])
export class ThresholdExpectationSchemaV1
  extends ExpectationSchemaV1<ExpectationKind.Threshold>
  implements IThresholdExpectationV1
{
  @IsOptional()
  @IsNumber(FINITE)
  min?: number;

  @IsOptional()
  @IsNumber(FINITE)
  max?: number;
}

export class NonZeroExpectationSchemaV1
  extends ExpectationSchemaV1<ExpectationKind.NonZero>
  implements INonZeroExpectationV1
{
  override kind = ExpectationKind.NonZero as const;
}

export type ExpectationV1 =
  | BaselineExpectationSchemaV1
  | SloExpectationSchemaV1
  | ThresholdExpectationSchemaV1
  | NonZeroExpectationSchemaV1;

export const EXPECTATION_SUBTYPES_V1 = [
  { value: BaselineExpectationSchemaV1, name: ExpectationKind.Baseline },
  { value: SloExpectationSchemaV1, name: ExpectationKind.Slo },
  { value: ThresholdExpectationSchemaV1, name: ExpectationKind.Threshold },
  { value: NonZeroExpectationSchemaV1, name: ExpectationKind.NonZero },
];
