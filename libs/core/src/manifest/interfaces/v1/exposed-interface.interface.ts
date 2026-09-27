import type { Transport } from '../../enums';

/** What a component serves; inbound metrics must be over one of these transports. */
export interface IExposedInterfaceV1 {
  readonly transport: Transport;
  /** Path to an API description, e.g. an OpenAPI document. */
  readonly spec?: string | undefined;
  readonly route?: string | undefined;
}
