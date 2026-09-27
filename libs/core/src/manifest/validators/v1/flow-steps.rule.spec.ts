import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  componentV1,
  dependencyV1,
  flowV1,
  manifestV1,
  runRule,
  stepV1,
} from '../../__fixtures__/manifest-v1.fixture';
import { FlowStepsRule } from './flow-steps.rule';

const rule = new FlowStepsRule();
const components = [
  componentV1('api', { dependsOn: [dependencyV1('db', 'mysql')] }),
  componentV1('mysql'),
];

describe('FlowStepsRule', () => {
  it('accepts steps over declared dependencies', () => {
    const flows = [flowV1('submit', { steps: [stepV1('api/db')] })];

    assert.deepEqual(runRule(rule, manifestV1({ components, flows })), []);
  });

  it('rejects a step over a dependency its component does not declare', () => {
    const flows = [flowV1('submit', { steps: [stepV1('api/db'), stepV1('api/cache')] })];

    assert.deepEqual(runRule(rule, manifestV1({ components, flows })), [
      {
        location: 'Flow/submit spec.steps.1.dependency',
        message: "api declares no dependency 'cache'; its dependencies are db",
      },
    ]);
  });

  it('rejects a step naming an unknown component', () => {
    const flows = [flowV1('submit', { steps: [stepV1('gateway/api')] })];

    assert.deepEqual(runRule(rule, manifestV1({ components, flows })), [
      {
        location: 'Flow/submit spec.steps.0.dependency',
        message: "unknown component 'gateway'; declared components are api, mysql",
      },
    ]);
  });
});
