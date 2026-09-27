import { IsIn, IsInt, IsOptional, IsString, Matches, Min } from 'class-validator';
import { DURATION_PATTERN } from '../../engine/duration';
import { ScenarioVersion } from '../scenario.enums';
import { DURATION_MESSAGE } from './identifiers';

export class ScenarioManifestSchema {
  @IsIn([ScenarioVersion.V1])
  version!: ScenarioVersion;

  /** For humans only: never emitted in any generated data, or a model could read the answer. */
  @IsOptional()
  @IsString()
  description?: string;

  /** Defaults to a hash of the scenario name. */
  @IsOptional()
  @IsInt()
  @Min(0)
  seed?: number;

  @Matches(DURATION_PATTERN, { message: DURATION_MESSAGE })
  duration!: string;

  /** Noise bucket width, i.e. the scrape interval being imitated. */
  @Matches(DURATION_PATTERN, { message: DURATION_MESSAGE })
  resolution = '15s';
}
