import type { ISourceConfig } from '@heimdall/config';

/** The only part of a configured source a connector reads. */
export type IConnectorSource = Pick<ISourceConfig, 'url' | 'timeoutMs' | 'auth'>;
