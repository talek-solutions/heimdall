import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { componentV1, manifestV1, runRule } from '../../__fixtures__/manifest-v1.fixture';
import { MemberRole, ReplicationMode, TopologyMode } from '../../enums';
import type { IMemberV1, ITopologyV1 } from '../../interfaces/v1';
import { TopologyRule } from './topology.rule';

const rule = new TopologyRule();

function member(name: string, role: MemberRole): IMemberV1 {
  return { name, role, telemetry: {}, indicators: [] };
}

function locationsFor(topology: ITopologyV1): string[] {
  return runRule(rule, manifestV1({ components: [componentV1('db', { topology })] })).map(
    ({ location }) => location,
  );
}

describe('TopologyRule', () => {
  it('accepts a primary with replicas', () => {
    const topology = {
      mode: TopologyMode.PrimaryReplica,
      replication: ReplicationMode.Async,
      members: [member('primary', MemberRole.Primary), member('replica-1', MemberRole.Replica)],
    };

    assert.deepEqual(locationsFor(topology), []);
  });

  it('rejects a primary-replica topology without exactly one primary', () => {
    const twoPrimaries = {
      mode: TopologyMode.PrimaryReplica,
      members: [member('a', MemberRole.Primary), member('b', MemberRole.Primary)],
    };
    const noPrimary = {
      mode: TopologyMode.PrimaryReplica,
      members: [member('a', MemberRole.Replica)],
    };

    assert.deepEqual(locationsFor(twoPrimaries), ['Component/db spec.topology.members']);
    assert.deepEqual(locationsFor(noPrimary), ['Component/db spec.topology.members']);
  });

  it('rejects replication on a topology that does not replicate', () => {
    const topology = {
      mode: TopologyMode.Cluster,
      replication: ReplicationMode.Sync,
      members: [member('node-1', MemberRole.Shard)],
    };

    assert.deepEqual(locationsFor(topology), ['Component/db spec.topology.replication']);
  });
});
