import { Module } from '@nestjs/common';
import { TelemetryModule } from '../telemetry.module';
import { LogsSource } from './logs.source';
import { MetricsSource } from './metrics.source';
import { redactorProvider } from './redactor.provider';
import { TracesSource } from './traces.source';

/** The engine's way in: sources that type, allowlist and scrub what they return (ADR 0008). */
@Module({
  imports: [TelemetryModule],
  providers: [redactorProvider, MetricsSource, LogsSource, TracesSource],
  exports: [MetricsSource, LogsSource, TracesSource],
})
export class TelemetrySourceModule {}
