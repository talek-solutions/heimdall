import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TelemetryConnectorFactory } from './connectors/telemetry-connector.factory';
import { TelemetryDatasourceConfigModule } from './datasource/telemetry-datasource-config.module';
import { FixtureBackendRegistry } from './fixture/fixture-backend.registry';

@Module({
  imports: [ConfigModule, TelemetryDatasourceConfigModule],
  providers: [TelemetryConnectorFactory, FixtureBackendRegistry],
  exports: [TelemetryConnectorFactory],
})
export class TelemetryModule {}
