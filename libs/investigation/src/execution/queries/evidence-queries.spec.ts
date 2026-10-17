import 'reflect-metadata';
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { FieldSemantic } from '@heimdall/config';
import { VertexType, type IComponentVertex, type SystemGraph } from '@heimdall/core/graph';
import { InteractionMode } from '@heimdall/core/manifest';
import { LogLineFormat, type ILogRecord, type RedactedText } from '@heimdall/telemetry';
import { loadGraph, ReferenceManifest } from '../../__fixtures__/investigation.fixture';
import { HopSide } from '../../enums';
import { InvestigationErrorCode } from '../../errors';
import { LogQlCompiler, narrow } from './logql.compiler';
import { TraceQlCompiler } from './traceql.compiler';

const UPDATE_ORDERS = { operation: 'UPDATE', table: 'orders' };

describe('LogQL and TraceQL from telemetry identities', () => {
  let graph: SystemGraph;
  const component = (name: string): IComponentVertex => {
    const vertex = graph.vertexOfType(`component:${name}`, VertexType.Component);
    assert.ok(vertex);
    return vertex;
  };

  before(async () => {
    graph = await loadGraph(ReferenceManifest.Checkout);
  });

  it('reads logs by the stream selector, quoting a literal filter, and splits the match by mapped meanings', () => {
    const compiled = new LogQlCompiler().compile(component('checkout'), {
      match: { ...UPDATE_ORDERS, route: '/api/checkout' },
      contains: 'say "hi" \\o/',
    });
    assert.ok(compiled.ok);

    assert.equal(compiled.compiled.query, '{service_name="checkout"} |= "say \\"hi\\" \\\\o/"');
    assert.deepEqual(compiled.compiled.narrowedBy, UPDATE_ORDERS);
    assert.deepEqual(compiled.compiled.ignored, ['route']);
    assert.equal(compiled.compiled.fields['msg'], FieldSemantic.Message);
  });

  it('refuses a component without a logs identity', () => {
    const compiled = new LogQlCompiler().compile(component('payment-provider'), {});

    assert.equal(!compiled.ok && compiled.errorCode, InvestigationErrorCode.NoLogsIdentity);
  });

  it('confirms a template with a regex filter tolerant of repeated spaces', () => {
    assert.equal(
      new LogQlCompiler().confirmation(
        '{service_name="orders-pg"}',
        'still waiting for ShareLock (x)',
      ),
      '{service_name="orders-pg"} |~ `still\\s+waiting\\s+for\\s+ShareLock\\s+\\(x\\)`',
    );
  });

  it('narrows by dropping the lines that contradict the match, keeping those that say nothing', () => {
    const record = (fields: Record<string, string>): ILogRecord => ({
      timestampMs: 0,
      format: LogLineFormat.Logfmt,
      fields: fields as Record<string, RedactedText>,
    });
    const kept = narrow(
      [
        record({ message: 'slow query', table: 'orders', operation: 'UPDATE' }),
        record({ message: 'slow query', table: 'stock', operation: 'SELECT' }),
        record({ message: 'acquire connection timeout' }),
      ],
      UPDATE_ORDERS,
    );

    assert.deepEqual(
      kept.map(({ fields }) => fields['table'] ?? '-'),
      ['orders', '-'],
    );
  });

  it("reads a hop's spans at the subject's end: client spans with db meanings for the caller", () => {
    const compiled = new TraceQlCompiler().compile(component('checkout'), {
      side: HopSide.Caller,
      mode: InteractionMode.Sync,
      match: { ...UPDATE_ORDERS, route: '/api/checkout' },
      errorsOnly: false,
    });
    assert.ok(compiled.ok);

    assert.equal(
      compiled.compiled.query,
      '{ resource.service.name = "checkout" && kind = client && span.db.operation.name = "UPDATE" && span.db.collection.name = "orders" }',
    );
    assert.deepEqual(compiled.compiled.ignored, ['route']);
  });

  it('reads server spans with the route for the target, consumers for async, and errors on request', () => {
    const traceQl = new TraceQlCompiler();
    const target = traceQl.compile(component('payments'), {
      side: HopSide.Target,
      mode: InteractionMode.Sync,
      match: { route: '/charges', method: 'POST', statusCode: '5..' },
      errorsOnly: true,
    });
    const consumer = traceQl.compile(component('payments'), {
      side: HopSide.Target,
      mode: InteractionMode.Async,
      errorsOnly: false,
    });
    assert.ok(target.ok && consumer.ok);

    assert.equal(
      target.compiled.query,
      '{ resource.service.name = "payments" && kind = server && span.http.route = "/charges" && span.http.request.method = "POST" && status = error }',
    );
    assert.deepEqual(target.compiled.ignored, ['statusCode'], 'a status pattern is not a number');
    assert.match(consumer.compiled.query, /kind = consumer/);
    assert.equal(
      traceQl.errors(consumer.compiled.query),
      '{ resource.service.name = "payments" && kind = consumer && status = error }',
    );
  });

  it('refuses a component without a traces identity', () => {
    const compiled = new TraceQlCompiler().compile(component('orders-pg'), { errorsOnly: false });

    assert.equal(!compiled.ok && compiled.errorCode, InvestigationErrorCode.NoTracesIdentity);
  });
});
