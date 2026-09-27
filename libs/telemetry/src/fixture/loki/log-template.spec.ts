import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PhasedCurve } from '../engine/curve';
import { DeterministicRandom } from '../engine/deterministic-random';
import { compileTemplate, renderTemplate, type ITemplateContext } from './log-template';

const LATENCY = new PhasedCurve(0.18, []);

function context(): ITemplateContext & { issues: string[] } {
  const issues: string[] = [];
  return {
    issues,
    resolveRef: (id, path) => {
      if (id === 'p99') {
        return LATENCY;
      }
      issues.push(`${path}: unknown metric series '${id}'`);
      return undefined;
    },
    hasTraceTemplate: (id) => id === 'checkout_post',
  };
}

function render(line: string, seed = 1): string {
  const compiled = compileTemplate(line, 'line', context());
  return renderTemplate(compiled, new DeterministicRandom(seed), 0, undefined);
}

describe('log templates', () => {
  it('renders every placeholder kind', () => {
    const line = render('id={uuid} span={hex:16} n={int:3-3} m={pick:GET|POST} took={ref:p99*1000}ms raw={ref:p99}');

    assert.match(
      line,
      /^id=[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12} span=[0-9a-f]{16} n=3 m=(GET|POST) took=180ms raw=0\.18$/,
    );
  });

  it('is deterministic per seed', () => {
    assert.equal(render('{uuid} {int:1-1000000}', 5), render('{uuid} {int:1-1000000}', 5));
    assert.notEqual(render('{uuid}', 5), render('{uuid}', 6));
  });

  it('leaves JSON and Go-template braces alone', () => {
    assert.equal(render('{"level":"info","msg":"ok"} {{.status}}'), '{"level":"info","msg":"ok"} {{.status}}');
  });

  it('writes an escaped brace literally', () => {
    assert.equal(render('GET /api/products/\\{id} 200 n={int:1-1}'), 'GET /api/products/{id} 200 n=1');
  });

  it('renders an unresolvable trace reference as an ID that points nowhere', () => {
    assert.match(render('trace_id={traceId:checkout_post}'), /^trace_id=[0-9a-f]{32}$/);
  });

  it('reports malformed and unknown placeholders', () => {
    const issues = context();
    compileTemplate(
      '{uuidd} {hex:0} {int:9-1} {pick:} {ref:missing} {ref:Bad} {traceId:nope}',
      'logs.yaml: streams.0.templates.0.line',
      issues,
    );

    assert.equal(issues.issues.length, 7);
    assert.ok(issues.issues.every((issue) => issue.startsWith('logs.yaml: streams.0.templates.0.line: {')));
  });
});
