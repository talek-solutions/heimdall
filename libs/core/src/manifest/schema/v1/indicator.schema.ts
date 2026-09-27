import { Type } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsOptional, IsString, Matches, ValidateNested } from 'class-validator';
import { IndicatorRole } from '../../enums';
import type { IIndicatorV1, IRatioV1 } from '../../interfaces/v1';
import { ExactlyOneOf } from './decorators/one-of.decorator';
import {
  BaselineExpectationSchemaV1,
  EXPECTATION_SUBTYPES_V1,
  ExpectationSchemaV1,
  type ExpectationV1,
} from './expectation.schema';
import { METRIC_REFERENCE, METRIC_REFERENCE_MESSAGE } from './identifiers';

export class RatioSchemaV1 implements IRatioV1 {
  @Matches(METRIC_REFERENCE, { message: METRIC_REFERENCE_MESSAGE })
  numerator!: string;

  @Matches(METRIC_REFERENCE, { message: METRIC_REFERENCE_MESSAGE })
  denominator!: string;
}

@ExactlyOneOf(['metric', 'ratio'])
export class IndicatorSchemaV1 implements IIndicatorV1 {
  @IsOptional()
  @Matches(METRIC_REFERENCE, { message: METRIC_REFERENCE_MESSAGE })
  metric?: string;

  @ValidateNested()
  @Type(() => RatioSchemaV1)
  ratio?: RatioSchemaV1;

  @IsEnum(IndicatorRole)
  role!: IndicatorRole;

  @ValidateNested()
  @Type(() => ExpectationSchemaV1, {
    discriminator: { property: 'kind', subTypes: EXPECTATION_SUBTYPES_V1 },
    keepDiscriminatorProperty: true,
  })
  expect: ExpectationV1 = new BaselineExpectationSchemaV1();

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  query?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  description?: string;
}
