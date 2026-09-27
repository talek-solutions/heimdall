import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  flowV1,
  functionalityV1,
  manifestV1,
  runRule,
} from '../../__fixtures__/manifest-v1.fixture';
import { FunctionalityFlowsRule } from './functionality-flows.rule';

const rule = new FunctionalityFlowsRule();

describe('FunctionalityFlowsRule', () => {
  it('accepts declared flows', () => {
    const manifest = manifestV1({
      functionalities: [functionalityV1('ordering', { flows: ['submit'] })],
      flows: [flowV1('submit')],
    });

    assert.deepEqual(runRule(rule, manifest), []);
  });

  it('rejects an undeclared flow, listing the declared ones', () => {
    const manifest = manifestV1({
      functionalities: [functionalityV1('ordering', { flows: ['submit', 'refund'] })],
      flows: [flowV1('submit')],
    });

    assert.deepEqual(runRule(rule, manifest), [
      {
        location: 'Functionality/ordering spec.flows.1',
        message: "unknown flow 'refund'; declared flows are submit",
      },
    ]);
  });
});
