import type { IDirectSourceConfig } from '@heimdall/config';
import type { DatasourceType } from './datasource-type.enum';

/** The backends a connector exists for. */
export type DirectTelemetryBackend = IDirectSourceConfig['type'];

export interface IFixtureDatasourceConfig {
  readonly scenario: string;
  /** End of the scenario timeline. Resolved once per process, so every query agrees on it. */
  readonly anchor: Date;
}

export interface ITelemetryDatasourceConfig {
  readonly datasources: Readonly<Record<DirectTelemetryBackend, DatasourceType>>;
  /** Present exactly when at least one backend is a fixture. */
  readonly fixture: IFixtureDatasourceConfig | undefined;
}
