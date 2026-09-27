import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  componentV1,
  dependencyV1,
  manifestV1,
  runRule,
} from '../../__fixtures__/manifest-v1.fixture';
import { DependencyTargetRule } from './dependency-target.rule';

const rule = new DependencyTargetRule();

describe('DependencyTargetRule', () => {
  it('accepts a declared target', () => {
    const components = [
      componentV1('api', { dependsOn: [dependencyV1('db', 'mysql')] }),
      componentV1('mysql'),
    ];

    assert.deepEqual(runRule(rule, manifestV1({ components })), []);
  });

  it('rejects an undeclared target, listing the declared components', () => {
    const components = [
      componentV1('api', { dependsOn: [dependencyV1('db', 'postgres')] }),
      componentV1('mysql'),
    ];

    assert.deepEqual(runRule(rule, manifestV1({ components })), [
      {
        location: 'Component/api spec.dependsOn.0.target',
        message: "unknown component 'postgres'; declared components are api, mysql",
      },
    ]);
  });
});
