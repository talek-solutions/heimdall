import { Module } from '@nestjs/common';
import { TelemetryModule } from '../telemetry.module';
import { MetricsSource } from './metrics.source';

/** The engine's way in: sources that type and allowlist what they return (ADR 0008). */
@Module({
  imports: [TelemetryModule],
  providers: [MetricsSource],
  exports: [MetricsSource],
})
export class TelemetrySourceModule {}
