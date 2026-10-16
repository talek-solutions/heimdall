import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { trace } from '@opentelemetry/api';
import { OtelEnvVariable, otlpSignals, shutdownTracing, startTracing } from './tracing';

describe('otlpSignals', () => {
  it('exports nothing unless an endpoint is configured', () => {
    assert.deepEqual(otlpSignals({}), { traces: false, metrics: false });
    assert.deepEqual(otlpSignals({ [OtelEnvVariable.Endpoint]: '  ' }), {
      traces: false,
      metrics: false,
    });
  });

  it('turns on both signals for the shared endpoint, and one for a per-signal endpoint', () => {
    assert.deepEqual(otlpSignals({ [OtelEnvVariable.Endpoint]: 'http://collector:4318' }), {
      traces: true,
      metrics: true,
    });
    assert.deepEqual(
      otlpSignals({ [OtelEnvVariable.TracesEndpoint]: 'http://collector:4318/v1/traces' }),
      { traces: true, metrics: false },
    );
    assert.deepEqual(
      otlpSignals({ [OtelEnvVariable.MetricsEndpoint]: 'http://collector:4318/v1/metrics' }),
      { traces: false, metrics: true },
    );
  });

  it('honours OTEL_SDK_DISABLED', () => {
    assert.deepEqual(
      otlpSignals({
        [OtelEnvVariable.Endpoint]: 'http://collector:4318',
        [OtelEnvVariable.SdkDisabled]: 'true',
      }),
      { traces: false, metrics: false },
    );
  });
});

describe('startTracing', () => {
  // Order matters: the global provider can be registered once per process.
  it('registers no SDK without an endpoint, so spans stay no-ops', async () => {
    startTracing({}, '0.0.0');

    assert.equal(trace.getTracer('spec').startSpan('noop').isRecording(), false);
    await shutdownTracing();
  });

  it('records spans once a traces endpoint is configured, and shuts down cleanly twice', async () => {
    startTracing(
      // A closed local port: nothing in this spec is exported, and nothing could be.
      { [OtelEnvVariable.TracesEndpoint]: 'http://127.0.0.1:9/v1/traces' },
      '0.0.0',
    );

    assert.equal(trace.getTracer('spec').startSpan('recorded').isRecording(), true);
    await shutdownTracing();
    await shutdownTracing();
  });
});
