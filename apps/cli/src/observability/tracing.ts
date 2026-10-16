import { metrics } from '@opentelemetry/api';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';

/** The standard OpenTelemetry variables that switch export on; the exporters read the rest. */
export enum OtelEnvVariable {
  Endpoint = 'OTEL_EXPORTER_OTLP_ENDPOINT',
  TracesEndpoint = 'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
  MetricsEndpoint = 'OTEL_EXPORTER_OTLP_METRICS_ENDPOINT',
  SdkDisabled = 'OTEL_SDK_DISABLED',
}

enum ResourceAttribute {
  ServiceName = 'service.name',
  ServiceVersion = 'service.version',
}

const SERVICE_NAME = 'heimdall';

export interface IOtlpSignals {
  readonly traces: boolean;
  readonly metrics: boolean;
}

interface IShutdown {
  shutdown(): Promise<void>;
}

let started: readonly IShutdown[] = [];

/** Export only to an endpoint someone configured: by default Heimdall sends nothing anywhere. */
export function otlpSignals(env: NodeJS.ProcessEnv): IOtlpSignals {
  if (env[OtelEnvVariable.SdkDisabled]?.toLowerCase() === 'true') {
    return { traces: false, metrics: false };
  }
  const any = isSet(env[OtelEnvVariable.Endpoint]);

  return {
    traces: any || isSet(env[OtelEnvVariable.TracesEndpoint]),
    metrics: any || isSet(env[OtelEnvVariable.MetricsEndpoint]),
  };
}

/**
 * Registers the SDK before anything creates a span (ADR 0017). Libraries hold only the API, so
 * without this every span and metric is a no-op. Diagnostics stay off: nothing here may write to
 * stdout (ADR 0006).
 */
export function startTracing(env: NodeJS.ProcessEnv, version: string): IOtlpSignals {
  const signals = otlpSignals(env);
  const resource = resourceFromAttributes({
    [ResourceAttribute.ServiceName]: SERVICE_NAME,
    [ResourceAttribute.ServiceVersion]: version,
  });
  const providers: IShutdown[] = [];

  if (signals.traces) {
    const tracerProvider = new NodeTracerProvider({
      resource,
      spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter())],
    });

    tracerProvider.register();
    providers.push(tracerProvider);
  }
  if (signals.metrics) {
    const meterProvider = new MeterProvider({
      resource,
      readers: [new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter() })],
    });

    metrics.setGlobalMeterProvider(meterProvider);
    providers.push(meterProvider);
  }
  started = providers;
  return signals;
}

/** Flushes and stops whatever `startTracing` registered; safe to call more than once. */
export async function shutdownTracing(): Promise<void> {
  const providers = started;

  started = [];
  await Promise.allSettled(providers.map((provider) => provider.shutdown()));
}

function isSet(value: string | undefined): boolean {
  return value !== undefined && value.trim() !== '';
}
