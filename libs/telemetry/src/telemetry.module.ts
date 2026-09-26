import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TelemetryConnectorFactory } from './connectors/telemetry-connector.factory';

@Module({
  imports: [ConfigModule],
  providers: [TelemetryConnectorFactory],
  exports: [TelemetryConnectorFactory],
})
export class TelemetryModule {}
